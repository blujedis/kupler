#!/usr/bin/env node

import { table } from 'table';
import { fileURLToPath } from 'url';
import { join, dirname, sep } from 'path';
import { existsSync, readdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync } from 'fs';
import { spawnSync as spawn } from 'child_process';
import nodeDirs from 'global-dirs';
import colors from 'ansi-colors';
import symbols from 'log-symbols';

const __dirname = getDirname();
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json')).toString());
const dependencies = Object.keys(pkg.dependencies);

const argv = process.argv.slice(2);
const appName = 'kupler';
const cmd = argv.shift();
const cwd = process.cwd();
const globalDirs = getDirectories(getGlobalPath());
const allowedCommands = ['link', 'unlink', 'help', 'status', 'path', 'version', 'install', 'uninstall', 'upgrade', 'prefix', 'use', 'unuse'];


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

${colors.dim('usage: $ $ <command> [module] [...options]')}

${colors.cyan('commands:')}
  install     installs a new package
  uninstall   uninstalls an existing package
  link        links locally installed package
  unlink      unlinks locally installed package
  use         links linked package to current
  unuse       unlinks locally linked packaged
  status      lists global linked package status table
  version     displays Kupler version
  path        displays Kupler install path
  prefix      displays Nodes prefix path
  help        displays Kupler menu

${colors.cyan('options:')}
  -g, --global   display all globals & status
`;
;

function getDirname() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

function getPrefixPath() {
  return nodeDirs.npm.prefix;
};

function getGlobalPath() {
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
      catch (_) { }
      stats.realPath = stats.realPath || stats.path;
      a.stats[c.name] = stats;
      return a;
    }, { names: [], stats: {} });

};

const getLinked = () => {
  const names = globalDirs.names;
  return names.filter(v => {
    const stats = globalDirs.stats[v];
    return stats.isLinked;
  });
};

const getMissing = () => {
  return Object.keys(globalDirs.stats).filter(v => globalDirs.stats[v].isMissing);
};

const isInstalled = (moduleName) => {
  const pkgPath = join(__dirname, `node_modules/${moduleName}/package.json`);
  return existsSync(pkgPath);
};

const runLinkUnlink = (command, moduleName) => {

  if (!moduleName)
    return {
      error: new Error(`cannot \'${command}\' using package name of undefined.`)
    }

  // checks if this package was install as
  // npm:package@some_alt_version
  // this means it's an alias install and
  // we need to link differently.
  const isAlias = /^npm:/.test(pkg.dependencies[moduleName]);

  if (!isInstalled(moduleName)) {
    if (dependencies.includes(moduleName))
      console.warn(`package.json includes \'${moduleName}\' but is not installed in node_modules.`)
    return { error: new Error(`package \'${moduleName}\' is not installed.`) };
  }

  let child;
  const rundir = join(__dirname, `node_modules/${moduleName}`);

  // Perhaps there's a syntax we can use but running
  // npm link in the directory will only duplicate the
  // link and not create a new link to the alias package
  // which is what we need. So manually create the link.
  if (isAlias) {
    try {

      const globalLinkPath = join(getGlobalPath(), moduleName);

      if (command === 'link') {
        symlinkSync(rundir, globalLinkPath);
        console.log(rundir, '->', globalLinkPath);
      }

      else {
        unlinkSync(globalLinkPath);
        console.log('unlinked: ' + rundir, '->', globalLinkPath);
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
    child = spawn('npm', [command], { stdio: 'inherit', cwd: rundir });
  }

  return child;

};

const runInstallUninstall = (command, moduleName) => {

  const rundir = __dirname;
  if (moduleName)
    argv.unshift(moduleName);
  const args = [command, ...argv];
  const child = spawn('npm', args, { stdio: 'inherit', cwd: rundir });

  return child;

};

const runUseUnuse = (command, moduleName) => {

  if (!moduleName)
    return {
      error: new Error(`cannot \'${command}\' using package name of undefined.`)
    }

  // Don't allow use/unuse when in Kupler's own project.
  if (cwd === __dirname)
    return {
      error: new Error(`running \'${command}\' within Kupler is prohibited. Did you mean to run ${command} in another project/directory?`)
    }

  const linked = getLinked();

  if (!linked.includes(moduleName)) {
    return {
      error: new Error(`command \'${command}\' failed, package \'${moduleName}\' is not linked in ${appName}.`)
    }
  }

  const _command = command === 'use' ? 'link' : 'unlink';
  const rundir = cwd;
  const args = [_command, moduleName];
  const child = spawn('npm', args, { stdio: 'inherit', cwd: rundir });

  return child;

};

const runUpgrade = (command) => {

  const rundir = __dirname;
  const args = ['npm-check-updates', '-u'];
  const child = spawn('npx', args, { stdio: 'inherit', cwd: rundir });

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
    console.error(colors.red(child.error.name + ': ' + child.error.message) + '\n');
}

else if (['install', 'uninstall'].includes(cmd)) {

  const child = runInstallUninstall(cmd, argv.shift());

  if (child.error)
    console.error(colors.red(child.error.name + ': ' + child.error.message) + '\n');

}

else if (['use', 'unuse'].includes(cmd)) {

  const child = runUseUnuse(cmd, argv.shift());

  if (child.error)
    console.error(colors.red(child.error.name + ': ' + child.error.message) + '\n');

}

else if (['link', 'unlink', 'status'].includes(cmd)) {

  let child;

  if (cmd === 'status')
    child = runStatus();
  else
    child = runLinkUnlink(cmd, argv.shift());

  if (child.error)
    console.error(colors.red(child.error.name + ': ' + child.error.message) + '\n');

}
