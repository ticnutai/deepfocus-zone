import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const xml=readFileSync('android/app/src/main/res/drawable/lemaan_emblem.xml','utf8');
const attrs={fillColor:'fill',strokeColor:'stroke',strokeWidth:'stroke-width',strokeLineCap:'stroke-linecap',pathData:'d'};
const paths=[...xml.matchAll(/<path\s+([^>]+)\/>/g)].map(([,s])=>'<path '+s.replace(/android:(\w+)="([^"]*)"/g,(_,k,v)=>`${attrs[k]}="${v==='#00000000'?'none':v}"`)+'/>').join('');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
  const render=async(size)=>{await page.setViewportSize({width:size,height:size});await page.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">${paths}</svg></body></html>`);return page.screenshot();};
  writeFileSync('play-assets/lemaan-icon-512.png',await render(512));
  // ICO directory with lossless PNG images rendered from the same vector.
  const sizes=[16,32,48,64,128,256];
  const images=[];for(const size of sizes)images.push(await render(size));
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  sizes.forEach((size,index)=>{const entry=6+16*index;header[entry]=size%256;header[entry+1]=size%256;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[index].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[index].length;});
  mkdirSync('electron/assets',{recursive:true});writeFileSync('electron/assets/icon.ico',Buffer.concat([header,...images]));
  console.log('Rendered canonical book icon: Play 512px and Windows ICO 16–256px');
} finally {await browser.close();}
