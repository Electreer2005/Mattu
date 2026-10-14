import {mkdir,cp,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist');
for(const file of ['index.html','Service.html','FAQ.html','Cart.html','Auth.html','Orders.html'])await copyFile(file,'dist/'+file);
for(const dir of ['Css','Js','Img'])await cp(dir,'dist/'+dir,{recursive:true});
console.log('Web de clientes preparada en dist.');
