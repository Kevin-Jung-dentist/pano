const fs=require('node:fs'),vm=require('node:vm');
for(const f of ['index.html','app.js','core.js','zip.js','style.css','game-core.js','play/index.html','play/play.css','play/play.js','play/canvas.js','play/terms.html','play/setup.html','play/practice.svg'])if(!fs.statSync('dist/'+f).size)throw Error(f);
for(const f of ['app.js','core.js','zip.js','game-core.js','play/play.js','play/canvas.js'])new vm.Script(fs.readFileSync('dist/'+f,'utf8'),{filename:f});
if(fs.existsSync('dist/_worker.js'))throw Error('Unexpected bundled worker in source dist');
console.log('Pano ZIP editor and League assets verified');