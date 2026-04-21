const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const yaml = require('js-yaml');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const judgeModeAliases = {
  none: 'none',
  internal: 'sheet',
  sheet: 'sheet',
  api: 'api',
  local: 'local',
};

const terminalModeAliases = {
  terminal: 'none',
  'terminal-ai': 'local',
};

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

  if (reportTo && judgeMode) {
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

  if (!parsed.primaryArg) {
    printUsageAndExit('Missing mode selector.');
  }

  return resolveSelection(parsed.primaryArg, parsed.profileArg);
}

function resolveSelection(selection, profileOverride) {
  const parts = selection.split(':').map((part) => part.trim()).filter(Boolean);

  if (parts.length === 1) {
    const [mode] = parts;

    if (!profileOverride) {
      printUsageAndExit(`Missing profile for selector: ${selection}`);
    }

    if (terminalModeAliases[mode]) {
      return {
        reportTo: 'terminal',
        judgeMode: terminalModeAliases[mode],
        profile: profileOverride,
        selector: `terminal:${terminalModeAliases[mode]}:${profileOverride}`,
      };
    }

    return {
      reportTo: 'sheet',
      judgeMode: resolveJudgeMode(mode),
      profile: profileOverride,
      selector: `sheet:${resolveJudgeMode(mode)}:${profileOverride}`,
    };
  }

  if (parts.length === 2) {
    const [first, second] = parts;

    if (profileOverride) {
      if (!['sheet', 'terminal'].includes(first)) {
        printUsageAndExit(`Selector ${selection} already includes a profile. Remove ${profileOverride} or use ${first}:${second} only.`);
      }

      return {
        reportTo: first,
        judgeMode: resolveJudgeMode(second),
        profile: profileOverride,
        selector: `${first}:${resolveJudgeMode(second)}:${profileOverride}`,
      };
    }

    if (terminalModeAliases[first]) {
      return {
        reportTo: 'terminal',
        judgeMode: terminalModeAliases[first],
        profile: second,
        selector: selection,
      };
    }

    return {
      reportTo: 'sheet',
      judgeMode: resolveJudgeMode(first),
      profile: second,
      selector: selection,
    };
  }

  if (parts.length === 3) {
    if (profileOverride) {
      printUsageAndExit(`Selector ${selection} already includes a profile. Remove --${profileOverride}.`);
    }

    const [reportToPart, modePart, profile] = parts;

    if (!['sheet', 'terminal'].includes(reportToPart)) {
      printUsageAndExit(`Unknown report target: ${reportToPart}`);
    }

    return {
      reportTo: reportToPart,
      judgeMode: resolveJudgeMode(modePart),
      profile,
      selector: selection,
    };
  }

  printUsageAndExit(`Invalid selector: ${selection}`);
}

function resolveJudgeMode(mode) {
  const judgeMode = judgeModeAliases[mode];

  if (!judgeMode) {
    printUsageAndExit(`Unknown judge mode: ${mode}`);
  }

  return judgeMode;
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
  const relativePath = configuredPath || 'tests/config/profiles.yaml';
  return path.resolve(process.cwd(), relativePath);
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
  const usage = [
    message,
    '',
    'Usage:',
    '  npm run test:sheet:api -- dev',
    '  npm run test:sheet:api -- --crow',
    '  npm run test:sheet:internal -- --stg',
    '  npm run test:terminal -- --prod',
    '  npm run test:profile -- api:dev',
    '  npm run test:profile -- api --crow',
    '',
    'Default profile file:',
    '  tests/config/profiles.yaml',
    '',
    'Optional .env override:',
    '  TEST_PROFILE_CONFIG=/path/to/profiles.yaml',
  ].join('\n');

  console.error(usage);
  process.exit(1);
}
