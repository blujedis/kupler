#!/usr/bin/env node

import { table } from 'table';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { spawnSync as spawn } from 'child_process';
import nodeDirs from 'global-dirs';
import colors from 'ansi-colors';
import symbols from 'log-symbols';

const __dirname = getDirname();
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json')).toString());
const dependencies = Object.keys(pkg.dependencies);
const argv = process.argv.slice(2);
const hasYarn = existsSync(join(__dirname, 'yarn.lock'));
const runWith = hasYarn ? 'yarn' : 'npm';
const appName = 'kupler';
const cmd = argv.shift();
const cwd = process.cwd();
const globalDirs = getDirectories(getGlobalPath());
const isWin = process.platform === 'win32';
const confRoot = join(homedir(), '.kupler');
const confPath = join(confRoot, 'conf.json');
const conf = getConf();
const allowedCommands = ['link', 'unlink', 'help', 'status', 'path', 'version', 'install', 'uninstall', 'upgrade', 'prefix', 'use', 'unuse', 'add', 'remove', 'open', 'show'];

if (!allowedCommands.includes(cmd)) {
  const commandList = `${allowedCommands.join('\n')}`
  console.warn(colors.yellow(`\n${symbols.warning} \`${cmd}\` is NOT a known command, available commands:\n`));
  console.log(commandList + '\n');
  console.log(colors.blue(`usage: $ <command> [module] [...options]\n`))
  process.exit();
}

const help = `
${colors.blue('Kupler')}
${colors.dim('version: ' + pkg.version)}
${colors.cyan('-'.repeat(70))}

${colors.dim(`usage: $ ${appName} <command> [module] [...options]`)}

${colors.cyan('commands:')}
  install, add            installs a new package
  uninstall, remove       uninstalls an existing package
  link                    links locally installed package
  unlink                  unlinks locally installed package
  use                     links linked package to current
  unuse                   unlinks locally linked packaged
  upgrade                 runs upgrade-interactive or npm-check-updates
  status, show            lists global linked package status table
  open                    opens directory where global links are stored
  version                 displays Kupler version
  path                    displays Kupler install path
  prefix                  displays Nodes prefix path
  help                    displays Kupler menu

${colors.cyan('options:')}
  -g, --global        display all globals & status        boolean

${colors.cyan('examples:')}
  ${appName} install react
  ${appName} uninstall react
  ${appName} link react
  ${appName} use react
  ${appName} install react16@npm:react@16.14.1
  ${appName} link react16
  ${appName} use react16 react ${colors.dim('(use react16 linked as react)')}
`;

function isValidMessage(res) {
  return (typeof res === 'object' && Object.keys(res).includes('error'))
    || typeof res === 'string'
    || (res instanceof Error);
}

function normalizeError(err) {
  const msg = `${err.name}: ${err.message}`;
  if (conf.showStack) {
    const trace = err.stack.split('\n').slice(1).join('\n');
    return {
      msg,
      trace
    };
  }
  return { msg };
}

function handleError(res) {

  if (!isValidMessage(res)) {
    const err = new Error(`Cannot \`handleError\`, must be string, Error or spawnSync child object as response!`);
    err.message = colors.red(err.message);
    throw err;
  }

  const lines = [];
  let err = res;

  if (typeof res === 'string')
    err = new Error(res);

  if (typeof res === 'object' && Object.keys(res).includes('error'))
    err = res.error;

  err = normalizeError(res);
  lines.push(colors.red(err.msg));

  if (err.trace)
    lines.push(err.trace);

  const str = lines.join('\n');

  console.error(str);

}

function getDirname() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

function getPrefixPath() {
  return nodeDirs.npm.prefix;
}

function getGlobalPath() {
  if (runWith === 'yarn')
    return join(nodeDirs.yarn.packages, '../../link'); // need to make sure this works on windows.
  return nodeDirs.npm.packages;
}

function getDirectories(source) {

  return readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() || dirent.isSymbolicLink())
    .reduce((a, c) => {
      a.names.push(c.name);
      const stats = {};
      try {
        stats.path = join(source, c.name);
        stats.isSymbolicLink = c.isSymbolicLink();
        stats.realPath = realpathSync(stats.path);
        stats.pathExists = existsSync(stats.realPath);
        stats.isLinked = stats.isSymbolicLink && stats.realPath.includes(__dirname) && dependencies.includes(c.name);
        stats.isMissing = dependencies.includes(c.name) && stats.realPath.includes(__dirname) && !stats.pathExists;
      }
      // eslint-disable-next-line no-empty
      catch (_) { }
      stats.realPath = stats.realPath || stats.path;
      a.stats[c.name] = stats;
      return a;
    }, { names: [], stats: {} });

}

function getConf() {
  try {
    const _conf = JSON.parse(readFileSync(confPath).toString());
    return {
      links: {},
      ..._conf
    };
  }
  catch (_) {
    return {
      links: {}
    };
  }
}

const saveConf = () => {
  if (!existsSync(confRoot))
    mkdirSync(confRoot);
  writeFileSync(confPath, JSON.stringify(conf, null, 2));
};

const getUseAliases = (dir) => {
  return conf.links[dir];
};

const saveUseAlias = (dir, moduleName, aliasName) => {
  conf.links[dir] = conf.links[dir] || {};
  conf.links[dir][moduleName] = aliasName;
  saveConf();
};

const removeUseAlias = (dir, moduleName) => {
  conf.links[dir] = conf.links[dir] || {};
  delete conf.links[dir][moduleName];
  saveConf();
};

const getLinked = () => {
  const names = globalDirs.names;
  return names.filter(v => {
    const stats = globalDirs.stats[v];
    return stats.isLinked;
  });
};

// const getMissing = () => {
//   return Object.keys(globalDirs.stats).filter(v => globalDirs.stats[v].isMissing);
// };

const isInstalled = (moduleName) => {
  const pkgPath = join(__dirname, `node_modules/${moduleName}/package.json`);
  return existsSync(pkgPath);
};

const runLinkUnlink = (command, moduleName) => {

  if (!moduleName)
    return {
      error: new Error(`cannot \`${command}\` using package name of undefined.`)
    }

  // checks if this package was install as
  // npm:package@some_alt_version
  // this means it's an alias install and
  // we need to link differently.
  const isAlias = /^npm:/.test(pkg.dependencies[moduleName]);
  const hasLinkAlias = argv.filter(v => !/--?/.test(v))[0];

  if (!isInstalled(moduleName)) {
    if (dependencies.includes(moduleName))
      console.warn(colors.yellow(`package.json includes \`${moduleName}\` but is not installed in node_modules.`));
    return { error: new Error(`package \`${moduleName}\` is not installed.`) };
  }

  if (hasLinkAlias) {
    console.warn(colors.yellow(`Alias ${hasLinkAlias} is not valid for command \`${command}\`, did you mean to run: \`${appName} use ${moduleName} ${hasLinkAlias}\`?`))
    process.exit();
  }

  let child;
  const sourcePath = join(__dirname, `node_modules/${moduleName}`);

  const successMessage = (type = command, name = moduleName) => {
    const useType = type === 'link' ? 'use' : 'unuse';
    const typeAlt = type === 'link' ? 'linked' : 'unlinked';
    return [
      `${colors.green('success')} ${typeAlt} "${name}"`,
      `${colors.blue('info')} you can now run \`${appName} ${useType} "${name}"\` in projects you wish to ${useType} this resource with.`
    ].join('\n');
  };

  if (isAlias) {
    try {

      const linkToPath = join(getGlobalPath(), moduleName);

      if (command === 'link') {

        symlinkSync(sourcePath, linkToPath);
        console.log(successMessage());

      }

      else {

        unlinkSync(linkToPath);
        console.log(successMessage());

      }

      child = {
        error: null
      };

    }

    catch (err) {
      child = {
        error: err
      };
    }

  }
  else {
    child = spawn(runWith, [command, ...argv], { stdio: 'inherit', cwd: sourcePath });
  }

  return child;

};

const runInstallUninstall = (command, moduleName) => {

  const rundir = __dirname;
  if (moduleName)
    argv.unshift(moduleName);

  // Help the user out if they tried to install
  // a package with "install" instead of "add" when using yarn
  if (runWith === 'yarn' && command === 'install' && moduleName)
    command = 'add';

  if (runWith === 'yarn' && command === 'uninstall')
    command = 'remove';

  const args = [command, ...argv];
  const child = spawn(runWith, args, { stdio: 'inherit', cwd: rundir });

  return child;

};

const runUseUnuse = (command, moduleName) => {

  if (!moduleName)
    return {
      error: new Error(`cannot \`${command}\` using package name of undefined.`)
    }

  // Don't allow use/unuse when in Kupler's own project.
  if (cwd === __dirname)
    return {
      error: new Error(`running \`${command}\` within Kupler is prohibited. Did you mean to run ${command} in another project/directory?`)
    }

  const linked = getLinked();

  if (!linked.includes(moduleName)) {
    return {
      error: new Error(`command \`${command}\` failed, package \`${moduleName}\` is not linked in ${appName}.`)
    }
  }

  const successMessage = (type = command, name = moduleName) => {
    const useType = type === 'use' ? 'unuse' : 'use';
    const typeAlt = type === 'use' ? 'used' : 'unused';
    const reuse = command === 'unuse' ? 'reuse' : null;
    return [
      `${colors.green('success')} ${typeAlt} "${name}"`,
      `${colors.blue('info')} you can now run \`${appName} ${useType} "${name}"\` in projects you wish to ${reuse || useType} this resource with.`
    ].join('\n');
  };

  const rundir = cwd;
  const _command = command === 'use' ? 'link' : 'unlink';
  let aliasName = argv.filter(v => !/--?/.test(v))[0];

  const links = getUseAliases(rundir);

  if (links && links[moduleName])
    aliasName = links[moduleName];

  if (aliasName) {

    try {

      const sourcePath = realpathSync(join(getGlobalPath(), moduleName));
      const linkToPath = join(rundir, 'node_modules', aliasName)

      if (_command === 'link') {


        symlinkSync(sourcePath, linkToPath);
        saveUseAlias(rundir, moduleName, aliasName);
        console.log(successMessage());

      }

      else {

        unlinkSync(linkToPath);
        removeUseAlias(rundir, moduleName);
        console.log(successMessage());

      }

      return {
        error: null
      };

    }

    catch (err) {

      return {
        error: err
      };

    }


  }

  else {

    const args = [_command, moduleName, ...argv];
    const child = spawn(runWith, args, { stdio: 'inherit', cwd: rundir });

    return child;

  }

};

const runUpgrade = () => {

  const rundir = __dirname;
  const shouldAddUpgrade = runWith === 'npm' && !argv.some(v => ['-u', '--upgrade'].includes(v));
  const args = runWith === 'yarn' ? ['upgrade-interactive', ...argv] : ['npm-check-updates', ...argv];
  if (shouldAddUpgrade)
    args.push('-u');
  const child = spawn(runWith, args, { stdio: 'inherit', cwd: rundir });

  return child;

};

const runStatus = () => {

  let output = getPrefixPath();

  if (!output)
    return {
      error: new Error(`Failed to locate npm prefix for globally installed modules.`)
    }

  output = getGlobalPath();
  const linkedDirs = getLinked();

  // [installed, linked]
  let installed = 0;
  let linked = 0;

  const isAll = argv.includes('-g') || argv.includes('--global')
  const tableSrc =
    isAll ? globalDirs.names : dependencies;

  const data = tableSrc.map(dir => {

    if (dependencies.includes(dir))
      installed += 1;

    if (linkedDirs.includes(dir))
      linked += 1;

    const stats = globalDirs.stats[dir];
    const isLinked = linkedDirs.includes(dir) ? symbols.success : symbols.error;
    const isSym = stats && stats.isSymbolicLink ? symbols.success : symbols.error;
    const realPath = (stats && stats.realPath) || 'n/a';

    let row = [dir];
    if (isAll)
      row.push(realPath);

    row = [...row, isSym, isLinked];

    return row;

  });

  let config = {};
  let header = [
    'Package'
  ];

  if (isAll) {
    config = {
      columns: [
        { width: 16 },
        { width: 50 },
        { width: 8, alignment: 'center' },
        { width: 6, alignment: 'center' }
      ]
    };
    header.push('Link Path');
  }

  header = [...header, 'Symbolic', 'Linked'];

  data.unshift(header);
  console.log();
  console.log(table(data, config));
  console.log(`installed: ${colors.yellow(installed)}   linked: ${colors.green(linked)}\n`);

  return {
    error: null
  };

};

const runOpen = () => {

  const command = isWin ? 'start' : 'open';
  const rundir = getGlobalPath();
  const child = spawn(command, ['.'], { stdio: 'inherit', cwd: rundir });

  return child;

};

if (cmd === 'help') {
  console.log(help);
}

else if (cmd === 'path') {
  console.log(__dirname);
}

else if (cmd === 'prefix') {
  console.log(getPrefixPath() || '');
}

else if (cmd === 'version') {
  console.log(pkg.version);
}

else if (cmd === 'upgrade') {
  const child = runUpgrade(cmd);
  if (child.error)
    handleError(child.error);
}

else if (cmd === 'open') {
  const child = runOpen();
  if (child.error)
    handleError(child.error);
}

else if (['install', 'uninstall', 'add', 'remove'].includes(cmd)) {

  const child = runInstallUninstall(cmd, argv.shift());

  if (child.error)
    handleError(child.error);

}

else if (['use', 'unuse'].includes(cmd)) {

  const child = runUseUnuse(cmd, argv.shift());

  if (child.error)
    handleError(child.error);

}

else if (['show', 'status'].includes(cmd)) {

  const child = runStatus();

  if (child.error)
    handleError(child.error);

}

else if (['link', 'unlink'].includes(cmd)) {

  const child = runLinkUnlink(cmd, argv.shift());

  if (child.error)
    handleError(child.error);

}
