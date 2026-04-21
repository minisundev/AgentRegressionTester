const { spawnSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

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
      sheetName: runtimeEnv.GOOGLE_SHEET_NAME,
      baseUrl: runtimeEnv.CONTROL_BASE_URL,
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

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--profile') {
      parsed.profileArg = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      parsed.profileArg = arg.slice('--profile='.length);
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
    printUsageAndExit('Missing profile selector.');
  }

  return resolveSelection(parsed.primaryArg);
}

function resolveSelection(selection) {
  const parts = selection.split(':').map((part) => part.trim()).filter(Boolean);

  if (parts.length === 2) {
    const [mode, profile] = parts;

    if (terminalModeAliases[mode]) {
      return {
        reportTo: 'terminal',
        judgeMode: terminalModeAliases[mode],
        profile,
        selector: selection,
      };
    }

    return {
      reportTo: 'sheet',
      judgeMode: resolveJudgeMode(mode),
      profile,
      selector: selection,
    };
  }

  if (parts.length === 3) {
    const [reportTo, mode, profile] = parts;

    if (!['sheet', 'terminal'].includes(reportTo)) {
      printUsageAndExit(`Unknown report target: ${reportTo}`);
    }

    return {
      reportTo,
      judgeMode: resolveJudgeMode(mode),
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
  if (!selection.profile) {
    return {
      ...process.env,
      REPORT_TO: selection.reportTo,
      JUDGE_MODE: selection.judgeMode,
    };
  }

  const profile = normalizeProfile(selection.profile);
  const baseUrlEnvKey = `CONTROL_BASE_URL_${profile.toUpperCase()}`;
  const sheetNameEnvKey = `GOOGLE_SHEET_NAME_${profile.toUpperCase()}`;
  const baseUrl = process.env[baseUrlEnvKey];
  const sheetName = process.env[sheetNameEnvKey] || profile;

  if (!baseUrl) {
    printUsageAndExit(`Missing ${baseUrlEnvKey} in .env`);
  }

  return {
    ...process.env,
    REPORT_TO: selection.reportTo,
    JUDGE_MODE: selection.judgeMode,
    CONTROL_BASE_URL: baseUrl,
    GOOGLE_SHEET_NAME: sheetName,
  };
}

function normalizeProfile(profile) {
  const trimmed = profile.trim().toLowerCase();

  if (!trimmed) {
    printUsageAndExit('Profile must not be empty.');
  }

  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    printUsageAndExit(`Invalid profile name: ${profile}`);
  }

  return trimmed;
}

function printUsageAndExit(message) {
  const usage = [
    message,
    '',
    'Usage:',
    '  npm run test:sheet:api -- dev',
    '  npm run test:sheet:internal -- stg',
    '  npm run test:terminal -- prod',
    '  npm run test:terminal:ai -- local',
    '  npm run test:profile -- api:dev',
    '  npm run test:profile -- internal:stg',
    '  npm run test:profile -- terminal:prod',
    '  npm run test:profile -- terminal-ai:local',
    '  npm run test:profile -- sheet:api:dev',
    '',
    'Required .env keys:',
    '  CONTROL_BASE_URL_DEV, CONTROL_BASE_URL_STG, CONTROL_BASE_URL_PROD, CONTROL_BASE_URL_LOCAL',
    'Optional .env keys:',
    '  GOOGLE_SHEET_NAME_DEV, GOOGLE_SHEET_NAME_STG, GOOGLE_SHEET_NAME_PROD, GOOGLE_SHEET_NAME_LOCAL',
  ].join('\n');

  console.error(usage);
  process.exit(1);
}
