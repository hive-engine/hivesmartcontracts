const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const contractsDir = path.join(__dirname, '../contracts');

fs.readdirSync(contractsDir).forEach((file) => {
  if (file.endsWith('.js') && !file.endsWith('_minify.js')) {
    const filename = file.replace('.js', '');
    const input = path.join(contractsDir, file);
    const output = path.join(contractsDir, `${filename}_minify.js`);
    execSync(`npx terser "${input}" --keep-fnames -c -o "${output}"`);
    console.log(`Minified: ${file} -> ${filename}_minify.js`);
  }
});
