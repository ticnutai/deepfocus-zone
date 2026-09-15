import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const mocks = {
  '@/hooks/useAuth': 'export const useAuth=()=>({user:{id:"qa"},isGuest:false})',
  '@/hooks/usePermissions': 'export const usePermissions=()=>({isAdmin:true,viewerIsAdmin:true})',
  '@/lib/study/store': 'const state={uiPrefs:{}};export const useStudy=()=>({state,setUiPref:()=>{}})',
  '@/integrations/supabase/client': 'export const supabase={from:()=>({select:()=>({eq:()=>({maybeSingle:()=>Promise.resolve({data:null})})})})}',
};
const app = await build({ stdin: { contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ThemeProvider} from './src/theme/ThemeProvider';import {ThemeStudioProvider,useThemeStudio} from './src/theme/ThemeStudioProvider';
function Screen(){const studio=useThemeStudio();const [tab,setTab]=useState('home');return <main dir="rtl"><header style={{height:60}}><button onClick={studio.start}>Start</button><button onClick={()=>setTab('home')}>Home</button><button onClick={()=>setTab('practice')}>Practice</button></header><button id={'target-'+tab} style={{marginTop:80,fontSize:16,padding:12}}>Target {tab}</button><p id="control" style={{fontSize:16}}>Control</p></main>}
createRoot(document.getElementById('root')).render(<ThemeProvider><ThemeStudioProvider><Screen/></ThemeStudioProvider></ThemeProvider>);`, resolveDir:process.cwd(),loader:'tsx'}, bundle:true,write:false,format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',plugins:[{name:'isolated-auth',setup(b){b.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));}}] });
const css=readFileSync('dist/assets/'+readdirSync('dist/assets').find(f=>f.endsWith('.css')));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?app.outputFiles[0].text:req.url==='/style.css'?css:'<html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for (const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:900},locale:'he-IL'});
    page.setDefaultTimeout(10000);
    console.log(`Checking ${width}px`);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    const target=page.locator('#target-home');
    await page.getByText('Start',{exact:true}).click();await target.click();
    const panel=page.getByTestId('live-design-panel');
    const bounds=await panel.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width,'panel fits viewport');
    await page.getByLabel('הגדל גודל טקסט',{exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#target-home')).fontSize==='17px');
    await page.getByLabel('גודל טקסט',{exact:true}).press('ArrowUp');
    await page.getByLabel('בחירת גופן',{exact:true}).selectOption('Arial, sans-serif');
    await page.getByLabel('בחירת עובי טקסט',{exact:true}).selectOption('700');
    await page.getByLabel('בחירת יישור',{exact:true}).selectOption('left');
    await page.getByLabel('הגדל ריפוד פנימי',{exact:true}).click();
    assert.equal(await target.evaluate(el=>getComputedStyle(el).padding),'13px');
    assert.equal(await page.locator('#control').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    await page.getByText('שמור עיצוב',{exact:true}).click();
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('app-theme-design-v1')));
    assert.deepEqual(stored.rules[0].styles,{'font-size':'18px','font-family':'Arial, sans-serif','font-weight':'700','text-align':'left',padding:'13px'});
    await page.reload();
    console.log('Saved; checking reload');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#target-home')).fontSize==='18px');
    assert.match(await target.evaluate(el=>getComputedStyle(el).fontFamily),/Arial/);
    await page.getByText('Start',{exact:true}).click();
    await page.getByRole('button',{name:'השהה',exact:true}).click();await page.getByText('Practice',{exact:true}).click();
    await page.getByRole('button',{name:'המשך עריכה',exact:true}).click();await page.locator('#target-practice').click();
    console.log('Checking second tab');
    await page.getByLabel('הגדל גודל טקסט',{exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#target-practice')).fontSize==='17px');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#target-practice').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log(`2 passed, 0 failed: controls, computed preview, save/reload, tab switch, cancel, safe viewport at 390/1440; ${url}; real editor with isolated auth/cloud adapters`);
} finally {await browser.close();server.close();}
