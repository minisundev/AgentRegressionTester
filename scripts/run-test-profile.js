const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const yaml = require('js-yaml');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

main();

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const resolved = resolveExecution(parsed);
  const runtimeEnv = buildRuntimeEnv(resolved);

  if (parsed.dryRun) {
    console.log(JSON.stringify({
      selector: resolved.selector,
      reportTo: runtimeEnv.REPORT_TO,
      judgeMode: runtimeEnv.JUDGE_MODE,
      profile: resolved.profile ?? '',
      sheetName: runtimeEnv.GOOGLE_SHEET_NAME ?? '',
      baseUrl: runtimeEnv.CONTROL_BASE_URL ?? '',
      requestMode: runtimeEnv.REQUEST_MODE,
      profileConfigPath: getProfileConfigPath(),
      passthroughArgs: parsed.passthroughArgs,
    }, null, 2));
    return;
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['run', 'test:all', '--', ...parsed.passthroughArgs], {
    stdio: 'inherit',
    env: runtimeEnv,
  });

  if (result.error) {
    console.error(`[test:profile] ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    primaryArg: undefined,
    profileArg: undefined,
    requestMode: undefined,
    passthroughArgs: [],
  };

  let passthroughMode = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (passthroughMode) {
      parsed.passthroughArgs.push(arg);
      continue;
    }

    if (arg === '--') {
      passthroughMode = true;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--profile') {
      const profileName = args[index + 1];
      if (!profileName) {
        printUsageAndExit('Missing value after --profile.');
      }
      setProfileArg(parsed, profileName);
      index += 1;
      continue;
    }

    if (arg === '--mode') {
      const mode = args[index + 1];
      if (!mode) {
        printUsageAndExit('Missing value after --mode.');
      }
      parsed.requestMode = normalizeRequestMode(mode);
      index += 1;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      parsed.requestMode = normalizeRequestMode(arg.slice('--mode='.length));
      continue;
    }

    if (arg.startsWith('--profile=')) {
      const profileName = arg.slice('--profile='.length);
      if (!profileName) {
        printUsageAndExit('Missing value after --profile=');
      }
      setProfileArg(parsed, profileName);
      continue;
    }

    if (arg.startsWith('--') && arg.length > 2) {
      setProfileArg(parsed, arg.slice(2));
      continue;
    }

    if (!parsed.primaryArg) {
      parsed.primaryArg = arg;
      continue;
    }

    parsed.passthroughArgs.push(arg);
  }

  return parsed;
}

function setProfileArg(parsed, profileName) {
  if (parsed.profileArg && parsed.profileArg !== profileName) {
    printUsageAndExit(`Multiple profiles were provided: ${parsed.profileArg}, ${profileName}`);
  }

  parsed.profileArg = profileName;
}

function resolveExecution(parsed) {
  const selectorFromArg = parseSelector(parsed.primaryArg, 'argument');
  const selectorFromLifecycle = selectorFromArg
    ? null
    : parseSelector(process.env.npm_lifecycle_event, 'script');

  if (selectorFromArg && parsed.profileArg) {
    const selectorProfile = selectorFromArg.profile;
    const flagProfile = normalizeProfile(parsed.profileArg);

    if (selectorProfile && selectorProfile !== flagProfile) {
      printUsageAndExit(`Profile conflict: selector uses ${selectorProfile}, but --profile uses ${flagProfile}.`);
    }
  }

  const reportTo = selectorFromArg?.reportTo ?? selectorFromLifecycle?.reportTo ?? process.env.REPORT_TO;
  const judgeMode = selectorFromArg?.judgeMode ?? selectorFromLifecycle?.judgeMode ?? process.env.JUDGE_MODE;
  const requestMode = parsed.requestMode ?? normalizeRequestMode(process.env.REQUEST_MODE ?? 'sync');
  const selectorProfile = selectorFromArg?.profile ?? selectorFromLifecycle?.profile;
  const profile = parsed.profileArg ?? selectorProfile ?? (!selectorFromArg ? parsed.primaryArg : undefined);

  if (!reportTo || !judgeMode) {
    printUsageAndExit('Select a run target with a script name like test:sheet:api:local or pass a selector like sheet:api:local.');
  }

  return {
    reportTo,
    judgeMode,
    requestMode,
    profile,
    selector: [
      reportTo,
      judgeMode,
      profile ?? 'default',
    ].join(':'),
  };
}

function buildRuntimeEnv(selection) {
  const runtimeEnv = {
    ...process.env,
    REPORT_TO: selection.reportTo,
    JUDGE_MODE: selection.judgeMode,
    REQUEST_MODE: selection.requestMode,
  };

  if (!selection.profile) {
    return runtimeEnv;
  }

  const profileName = normalizeProfile(selection.profile);
  const profile = resolveProfile(profileName);

  return {
    ...runtimeEnv,
    CONTROL_BASE_URL: profile.baseUrl,
    GOOGLE_SHEET_NAME: profile.sheetName || profileName,
  };
}

function resolveProfile(profileName) {
  const profiles = loadProfiles();

  if (profiles[profileName]) {
    return profiles[profileName];
  }

  const upperName = profileName.toUpperCase();
  const envBaseUrl = process.env[`CONTROL_BASE_URL_${upperName}`];

  if (envBaseUrl) {
    return {
      baseUrl: envBaseUrl,
      sheetName: process.env[`GOOGLE_SHEET_NAME_${upperName}`] || profileName,
    };
  }

  const availableProfiles = Object.keys(profiles);
  const availableMessage = availableProfiles.length > 0
    ? `Available profiles in ${getProfileConfigPath()}: ${availableProfiles.sort().join(', ')}`
    : `No profiles found in ${getProfileConfigPath()}`;

  printUsageAndExit([
    `Unknown profile: ${profileName}`,
    availableMessage,
    `Add it to ${getProfileConfigPath()} or define CONTROL_BASE_URL_${upperName} in .env`,
  ].join('\n'));
}

function loadProfiles() {
  const configPath = getProfileConfigPath();

  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw);

  if (!parsed) {
    return {};
  }

  const profileSource = isPlainObject(parsed.profiles) ? parsed.profiles : parsed;

  if (!isPlainObject(profileSource)) {
    printUsageAndExit(`Invalid profile config format: ${configPath}`);
  }

  const profiles = {};

  for (const [profileName, value] of Object.entries(profileSource)) {
    const normalizedName = normalizeProfile(profileName);
    profiles[normalizedName] = normalizeProfileEntry(normalizedName, value, configPath);
  }

  return profiles;
}

function normalizeProfileEntry(profileName, value, configPath) {
  if (typeof value === 'string') {
    return {
      baseUrl: value,
      sheetName: profileName,
    };
  }

  if (!isPlainObject(value) || typeof value.baseUrl !== 'string') {
    printUsageAndExit(`Invalid profile entry for ${profileName} in ${configPath}`);
  }

  return {
    baseUrl: value.baseUrl,
    sheetName: typeof value.sheetName === 'string' && value.sheetName.trim()
      ? value.sheetName.trim()
      : profileName,
  };
}

function getProfileConfigPath() {
  const configuredPath = process.env.TEST_PROFILE_CONFIG?.trim();
  const relativePath = configuredPath || loadUsageConfig().defaultProfilePath;
  return path.resolve(process.cwd(), relativePath);
}

function getUsageConfigPath() {
  return path.resolve(process.cwd(), 'tests/config/settings/usage.yaml');
}

function loadUsageConfig() {
  try {
    const contents = fs.readFileSync(getUsageConfigPath(), 'utf8');
    const data = yaml.load(contents) ?? {};
    return {
      defaultProfilePath: data.defaultProfilePath ?? 'tests/config/settings/profiles.yaml',
      examples: Array.isArray(data.examples) ? data.examples : [],
      defaultProfileLabel: data.defaultProfileLabel ?? 'Default profile file:',
      envOverrideLabel: data.envOverrideLabel ?? 'Optional .env override:',
      envOverrideExample: data.envOverrideExample ?? '',
    };
  } catch {
    return {
      defaultProfilePath: 'tests/config/settings/profiles.yaml',
      examples: [],
      defaultProfileLabel: '',
      envOverrideLabel: '',
      envOverrideExample: '',
    };
  }
}

function normalizeProfile(profile) {
  const trimmed = profile?.trim().toLowerCase();

  if (!trimmed) {
    printUsageAndExit('Profile must not be empty.');
  }

  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    printUsageAndExit(`Invalid profile name: ${profile}`);
  }

  return trimmed;
}

function normalizeRequestMode(mode) {
  const normalized = mode?.trim().toLowerCase();

  if (normalized !== 'sync' && normalized !== 'stream') {
    printUsageAndExit(`Invalid request mode: ${mode}. Use sync or stream.`);
  }

  return normalized;
}

function parseSelector(selector, source) {
  const trimmed = selector?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':').filter(Boolean);
  const normalizedParts = parts[0] === 'test' ? parts.slice(1) : parts;

  if (normalizedParts.length === 0) {
    return null;
  }

  const reportTo = normalizedParts[0];

  if (reportTo !== 'sheet' && reportTo !== 'terminal') {
    return null;
  }

  if (reportTo === 'sheet') {
    return parseSheetSelector(normalizedParts, source);
  }

  return parseTerminalSelector(normalizedParts, source);
}

function parseSheetSelector(parts, source) {
  if (parts.length < 2) {
    printUsageAndExit(`Invalid ${source} selector: ${parts.join(':')}`);
  }

  const judgeMode = normalizeSheetJudgeMode(parts[1], source, parts.join(':'));
  const profile = parts[2] ? normalizeProfile(parts[2]) : undefined;

  if (parts.length > 3) {
    printUsageAndExit(`Invalid ${source} selector: ${parts.join(':')}`);
  }

  return {
    reportTo: 'sheet',
    judgeMode,
    profile,
  };
}

function parseTerminalSelector(parts, source) {
  if (parts.length > 3) {
    printUsageAndExit(`Invalid ${source} selector: ${parts.join(':')}`);
  }

  let judgeMode = 'none';
  let profile;

  if (parts.length >= 2) {
    if (parts[1] === 'ai') {
      judgeMode = 'local';
      profile = parts[2] ? normalizeProfile(parts[2]) : undefined;
    } else {
      profile = normalizeProfile(parts[1]);
    }
  }

  return {
    reportTo: 'terminal',
    judgeMode,
    profile,
  };
}

function normalizeSheetJudgeMode(judgeAlias, source, selector) {
  const judgeModeMap = {
    none: 'none',
    internal: 'sheet',
    sheet: 'sheet',
    api: 'api',
    gpt: 'gpt',
    local: 'local',
  };

  const judgeMode = judgeModeMap[judgeAlias];

  if (!judgeMode) {
    printUsageAndExit(`Invalid ${source} selector: ${selector}`);
  }

  return judgeMode;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function printUsageAndExit(message) {
  const config = loadUsageConfig();
  const profilePath = path.relative(process.cwd(), getProfileConfigPath()) || getProfileConfigPath();

  const usage = [
    message,
    '',
    'Usage:',
    ...config.examples.map((line) => `  ${line}`),
    '',
    config.defaultProfileLabel,
    `  ${profilePath}`,
    '',
    config.envOverrideLabel,
    `  ${config.envOverrideExample}`,
  ].join('\n');

  console.error(usage);
  process.exit(1);
}
