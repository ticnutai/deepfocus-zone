// Isolated headless regression for the scroll boundary used by DafLearningTab.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { contents: `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useStableMobileNavigation} from './src/hooks/useStableMobileNavigation';
function App(){const [step,setStep]=useState(0);const [chosen,setChosen]=useState(false);const stable=useStableMobileNavigation(true,chosen);
return <div id="scroll" style={location.hash==='#nested'?{height:'100vh',overflowY:'auto'}:{}}>
<div style={{height:900}}>תוכן מעל הניווט</div>
<div {...stable} id="navigator" style={{...stable.style,boxSizing:'border-box',padding:12,border:'1px solid gold'}}>
<div style={{height:[360,100,280,120][step]}}><h2>{['סדרים','מסכתות','דפים','עמודים'][step]}</h2>
<button id="next" onClick={()=>setStep(s=>Math.min(3,s+1))}>הבא</button>
{step===3&&<button id="choose" onClick={()=>setChosen(true)}>עמוד א</button>}
<button id="back" onClick={()=>setStep(s=>Math.max(0,s-1))}>חזרה</button></div></div>
{chosen&&<div id="content" style={{height:940}}>תוכן הדף</div>}
</div>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader:'tsx' }, bundle:true,write:false,format:'esm',jsx:'automatic'});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button{padding:12px}</style><div id="root"></div><script type="module" src="/bundle.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
let passed=0;
try {
  for(const width of [390,430]) for(const mode of ['window','nested']) {
    const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,locale:'he-IL',timezoneId:'Asia/Jerusalem',colorScheme:'light'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#${mode}`);
    await page.locator('#next').waitFor();
    await page.evaluate(mode=>{const el=mode==='nested'?document.querySelector('#scroll'):document.scrollingElement;el.scrollTop=el.scrollHeight;},mode);
    const top=await page.locator('#navigator').evaluate(el=>el.getBoundingClientRect().top);
    for(const id of ['next','next','next','back','back','back']) {
      await page.locator('#'+id).tap();
      await page.waitForTimeout(40);
      const after=await page.locator('#navigator').evaluate(el=>el.getBoundingClientRect().top);
      assert.ok(Math.abs(after-top)<2,`${width}/${mode}/${id}: navigator shifted ${after-top}px`);
    }
    for(let i=0;i<3;i++) await page.locator('#next').tap();
    await page.locator('#choose').tap();
    await page.waitForTimeout(40);
    const layout=await page.evaluate(()=>{const panel=document.querySelector('#navigator');return {top:panel.getBoundingClientRect().top,height:panel.getBoundingClientRect().height,gap:document.querySelector('#content').getBoundingClientRect().top-panel.getBoundingClientRect().bottom,min:panel.style.minHeight};});
    assert.ok(Math.abs(layout.top-top)<2,'selection keeps scroll position');
    assert.equal(layout.min,'','temporary reserved height released');
    assert.ok(layout.height<200&&Math.abs(layout.gap)<2,'content directly below compact selector');
    assert.deepEqual(errors,[]);passed++;await page.close();
  }
  console.log(JSON.stringify({passed,failed:0,scenarios:'390/430 x window/nested scroll; forward and back across all four steps'}));
} finally {await browser.close();server.close();}
