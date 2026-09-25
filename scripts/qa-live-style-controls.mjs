import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

// Optional, reproducible references from the actual editor; never personal browser state.
if (process.argv.includes('--help')) {
  console.log('node scripts/qa-live-style-controls.mjs [--artifacts DIRECTORY] [--css FILE]\nRuns isolated headless QA at 390/1440px. Optional screenshots and measured styles use the real editor, not a mock design.');
  process.exit(0);
}
const option = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `${name} requires a value`);
  return resolve(process.argv[index + 1]);
};
const artifacts = option('--artifacts');
const cssPath = option('--css');
if (artifacts) mkdirSync(artifacts, { recursive: true });
const evidence = { createdAt: new Date().toISOString(), implementation: 'real ThemeStudioProvider; isolated auth/cloud adapters', viewports: [] };

const mocks = {
  '@/hooks/useAuth': 'export const useAuth=()=>({user:{id:"qa"},isGuest:false})',
  '@/hooks/usePermissions': 'export const usePermissions=()=>({isAdmin:true,viewerIsAdmin:true})',
  '@/lib/study/store': 'const state={uiPrefs:{}};export const useStudy=()=>({state,setUiPref:()=>{}})',
  '@/integrations/supabase/client': 'export const supabase={from:()=>({select:()=>({eq:()=>({maybeSingle:()=>Promise.resolve({data:null})})})})}',
};
const app = await build({ define: {
  'import.meta.env.MODE': '"test"',
  'import.meta.env.VITE_APP_VARIANT': '"developer"',
}, stdin: { contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ThemeProvider} from './src/theme/ThemeProvider';import {ThemeStudioProvider,useThemeStudio} from './src/theme/ThemeStudioProvider';
function Screen(){const studio=useThemeStudio();const [tab,setTab]=useState('home');return <main dir="rtl"><header style={{height:60}}><button onClick={studio.start}>Start</button><button onClick={()=>setTab('home')}>Home</button><button onClick={()=>setTab('practice')}>Practice</button></header><button id={'target-'+tab} style={{marginTop:80,fontSize:16,padding:12}}>Target {tab}</button><p id="control" style={{fontSize:16}}>Control</p></main>}
createRoot(document.getElementById('root')).render(<ThemeProvider><ThemeStudioProvider><Screen/></ThemeStudioProvider></ThemeProvider>);`, resolveDir:process.cwd(),loader:'tsx'}, bundle:true,write:false,format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',plugins:[{name:'isolated-auth',setup(b){b.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));}}] });
const css=readFileSync(cssPath || 'dist/assets/'+readdirSync('dist/assets').find(f=>f.endsWith('.css')));
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
    const toggle=page.getByRole('switch',{name:'עריכה חיה',exact:true});
    assert.equal(await toggle.getAttribute('aria-checked'),'false');
    const toggleBounds=await toggle.boundingBox();
    assert.equal(toggleBounds.width,toggleBounds.height,'floating icon is circular, not squashed');
    assert.ok(toggleBounds.width>=44,'toggle has a useful touch target');
    const captureToggle = async state => {
      if (artifacts) await page.screenshot({animations:'disabled',path:join(artifacts,`${width}-toggle-${state}.png`),clip:{x:toggleBounds.x-8,y:toggleBounds.y-8,width:toggleBounds.width+16,height:toggleBounds.height+16}});
    };
    await captureToggle('off');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'),'true');
    await captureToggle('on');
    await target.click();
    const panel=page.getByTestId('live-design-panel');
    const bounds=await panel.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width,'panel fits viewport');
    assert.ok(bounds.y+bounds.height<=toggleBounds.y,'panel does not overlap the floating toggle');
    assert.ok(await toggle.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'toggle remains clickable above overlays');
    const capture = async (name, anchor) => {
      if (!artifacts) return;
      if (anchor) await anchor.scrollIntoViewIfNeeded();
      await panel.screenshot({ path: join(artifacts, `${width}-${name}.png`) });
    };
    await capture('overview');
    await capture('gradients', page.getByText('הגרדיאנטים שלי', { exact: true }));
    await page.getByLabel('הגדל גודל טקסט',{exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#target-home')).fontSize==='17px');
    await page.getByLabel('גודל טקסט',{exact:true}).press('ArrowUp');
    await page.getByLabel('בחירת גופן',{exact:true}).selectOption('Arial, sans-serif');
    await page.getByLabel('בחירת עובי טקסט',{exact:true}).selectOption('700');
    await page.getByLabel('בחירת יישור',{exact:true}).selectOption('left');
    await capture('typography', page.getByLabel('גודל טקסט', { exact: true }));
    if (artifacts) evidence.viewports.push(await panel.evaluate((el, viewportWidth) => {
      const read = node => { const s = getComputedStyle(node); return Object.fromEntries(['fontFamily','fontSize','color','backgroundColor','borderColor','borderRadius','borderWidth','height','width','padding','gap'].map(k => [k, s[k]])); };
      return { width: viewportWidth, height: 900, panel: read(el), field: read(el.querySelector('[aria-label="גודל טקסט"]')), increment: read(el.querySelector('[aria-label="הגדל גודל טקסט"]')), save: read([...el.querySelectorAll('button')].find(b => b.textContent === 'שמור עיצוב')) };
    }, width));
    await capture('dimensions', page.getByLabel('גובה מרבי', { exact: true }));
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
    assert.equal(await toggle.getAttribute('aria-checked'),'false','reload starts safely with capture off');
    await toggle.focus();await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-checked'),'true','keyboard toggles editing');
    await page.getByRole('button',{name:'השהה',exact:true}).click();await page.getByText('Practice',{exact:true}).click();
    await page.getByRole('button',{name:'המשך עריכה',exact:true}).click();await page.locator('#target-practice').click();
    console.log('Checking second tab');
    await page.getByLabel('הגדל גודל טקסט',{exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#target-practice')).fontSize==='17px');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'),'false');
    assert.equal(await panel.count(),0,'switch off closes the selected editor');
    assert.equal(await page.locator('#target-practice').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    const afterOff=await page.evaluate(()=>JSON.parse(localStorage.getItem('app-theme-design-v1')));
    assert.deepEqual(afterOff.rules,stored.rules,'switch off preserves committed rules');
    await page.getByText('Home',{exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#target-home')).fontSize==='18px');
    await toggle.click();await target.click();await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-checked'),'true','Escape closes panel before leaving mode');
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-checked'),'false');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log(`2 passed, 0 failed: floating toggle/click/keyboard, draft cancellation, saved rules, controls, computed preview, save/reload, tab switch, Escape, safe viewport at 390/1440; ${url}; real editor with isolated auth/cloud adapters`);
  if (artifacts) writeFileSync(join(artifacts, 'measurements.json'), JSON.stringify({ ...evidence, url, passed: 2, failed: 0 }, null, 2));
} finally {await browser.close();server.close();}
