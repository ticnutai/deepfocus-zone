import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const app = await build({ stdin: { contents: `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useScrollToSelectedQuestions} from './src/hooks/useScrollToSelectedQuestions';
function App(){const [confirmed,setConfirmed]=useState(false);const [key,setKey]=useState('chapter');const ref=useScrollToSelectedQuestions(confirmed,key);return <><div style={{height:500}}>Header</div><button onClick={()=>setKey('verse')}>Chapter</button><button onClick={()=>setConfirmed(true)}>Verse</button><div style={{height:800}}>Navigation</div><div ref={ref} hidden={!confirmed} data-testid="questions" style={{minHeight:1000}}>Questions</div></>};
createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader:'tsx' }, bundle:true, write:false, format:'esm', jsx:'automatic', tsconfig:'tsconfig.app.json' });
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?app.outputFiles[0].text:'<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const width of [320,390,1280]){
    const page=await browser.newPage({viewport:{width,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'Chapter',exact:true}).click();
    assert.equal(await page.evaluate(()=>scrollY),0,'intermediate selection must not scroll');
    await page.getByRole('button',{name:'Verse',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-testid="questions"]').getBoundingClientRect().top)<2);
    assert.ok(await page.evaluate(()=>scrollY>1000),'final selection scrolls to questions');
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('3 passed, 0 failed: real viewport scroll only after final selection at 320/390/1280, isolated hook fixture');
} finally {await browser.close();server.close();}
