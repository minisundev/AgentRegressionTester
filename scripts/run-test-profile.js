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
  const reportTo = process.env.REPORT_TO;
  const judgeMode = process.env.JUDGE_MODE;

  if (!reportTo || !judgeMode) {
    printUsageAndExit('REPORT_TO and JUDGE_MODE must be set. Use one of the npm test scripts.');
  }

  return {
    reportTo,
    judgeMode,
    profile: parsed.profileArg ?? parsed.primaryArg,
    selector: [
      reportTo,
      judgeMode,
      parsed.profileArg ?? parsed.primaryArg ?? 'default',
    ].join(':'),
  };
}

function buildRuntimeEnv(selection) {
  const runtimeEnv = {
    ...process.env,
    REPORT_TO: selection.reportTo,
    JUDGE_MODE: selection.judgeMode,
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
