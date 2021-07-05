#!/usr/bin/env node

import { table } from 'table';
import { fileURLToPath } from 'url';
import { join, dirname, sep } from 'path';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import { spawnSync as spawn } from 'child_process';
import colors from 'ansi-colors';
import symbols from 'log-symbols';

const __dirname = getDirname();
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json')).toString());
const dependencies = Object.keys(pkg.dependencies);

const argv = process.argv.slice(2);
const appName = 'kupler';
const cmd = argv.shift();
const cwd = process.cwd();
const allowedCommands = ['link', 'unlink', 'help', 'status', 'path', 'version', 'install', 'uninstall', 'upgrade'];

if (!allowedCommands.includes(cmd)) {
  console.warn(`command ${cmd} is unknown try one of [${allowedCommands.join(', ')}] or: \n\n \`$ ${appName} help\`\n`)
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
  unuse       unlinks locally linked packaged.
  status      lists global linked package status table
  version     displays Kupler version
  path        displays Kupler install path
  help        displays Kupler menu

${colors.cyan('options:')}
  -d, --detail   display all globals & their status
  -a, --alias    install package with alias
`;
;

function getDirname() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

const getPrefix = () => {
  const child = spawn('npm', ['config', 'get', 'prefix'], { stdio: 'pipe' });
  return (child.stdout || '').toString().replace(/\n/g, '');
};

const getDirectories = source => {

  return readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() || dirent.isSymbolicLink())
    .reduce((a, c) => {
      a.names.push(c.name);
      const stats = {};
      try {
        stats.path = join(source, c.name);
        stats.isSymbolicLink = c.isSymbolicLink();
        stats.realPath = realpathSync(stats.path);
      }
      catch (_) { }
      stats.realPath = stats.realPath || stats.path;
      a.stats[c.name] = stats;
      return a;
    }, { names: [], stats: {} });

};

const getLinked = (globalDirs) => {
  globalDirs = globalDirs || getDirectories(output).names;
  if (globalDirs.names)
    globalDirs = globalDirs.names;
  return globalDirs.filter(v => dependencies.includes(v));
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

  if (!isInstalled(moduleName)) {
    if (dependencies.includes(moduleName))
      console.warn(`package.json includes \'${moduleName}\' but is not installed in node_modules.`)
    return { error: new Error(`package \'${moduleName}\' is not installed.`) };
  }

  const rundir = join(__dirname, `node_modules/${moduleName}`);
  const args = [command];
  const child = spawn('npm', args, { stdio: 'inherit', cwd: rundir });

  return child;

};

const runInstallUninstall = (command, moduleName) => {

  if (command === 'uninstall' && !moduleName)
    return {
      error: new Error(`cannot \'${command}\' using package name of undefined.`)
    }

  const rundir = __dirname;
  const args = command === 'uninstall' ? [command, moduleName, ...argv] : [command, ...argv];
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

  let output = getPrefix();

  if (!output)
    return {
      error: new Error(`Failed to locate npm prefix for globally installed modules.`)
    }

  output = join(output, 'lib/node_modules');
  const globalDirs = getDirectories(output);
  const linkedDirs = getLinked(globalDirs);

  // [installed, linked]
  let installed = 0;
  let linked = 0;

  const isAll = argv.includes('-d') || argv.includes('--detail')
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
  //const dir = join(__dirname, '..');
  console.log(__dirname + '\n');
}

else if (cmd === 'version') {
  console.log(pkg.version + '\n');
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
