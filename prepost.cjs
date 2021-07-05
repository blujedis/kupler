const pkg = require('./package.json');
const { writeFileSync, readFileSync } = require('fs');
const colors = require('ansi-colors');
const argv = process.argv.slice(2);

const success = colors.green('✔')
const error = colors.red('✖');

try {

  if (argv.includes('pre')) {

    const deps = { ...pkg.dependencies };
    writeFileSync('./depenencies.json', JSON.stringify(deps, null, 2));
    console.log(success, 'saved current dependencies');

    pkg.dependencies = {};
    writeFileSync('./package.json', JSON.stringify(pkg, null, 2));
    console.log(success, 'cleaned package dependencies');

  }

  else {

    const deps = JSON.parse(readFileSync('./dependencies.json').toString());
    pkg.dependencies = deps;

    writeFileSync('./package.json', JSON.stringify(pkg, null, 2));
    console.log(success, 'updated package dependencies');

  }

}
catch (err) {
  console.error(error, err.message);
}


