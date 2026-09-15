// Isolated real-component QA: no user account, cloud writes or personal browser.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const fixture = `export const cardSourceOwner=()=>undefined; const cards=Array.from({length:320},(_,i)=>({id:String(i),question:'בדיקה '+i,type:'flashcard',answer:'תשובה',deckId:'d',tags:[i%2?'source:ai':'source:shemesh'],stats:{totalReviews:0,correct:0,incorrect:0},srs:{due:0}})); export const useStudy=()=>({state:{cards,decks:[],categories:[]},deleteCard:()=>{throw Error('No real deletion in QA')}});`;
const result = await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SmartSearch} from './src/components/study/SmartSearch'; createRoot(document.getElementById('root')).render(<SmartSearch onPractice={id=>document.body.dataset.practiceCard=id} variant={location.hash==='#modal'?'modal':'page'}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',plugins:[{name:'isolated-data',setup(b){
  const mocks={'@/lib/study/store':fixture,'@/hooks/usePermissions':'export const usePermissions=()=>({isAdmin:false});','@/integrations/supabase/client':'export const supabase={rpc:async()=>({data:[]})};'};
  b.onResolve({filter:/^@\//},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));
}}]});
const css=readFileSync('dist/assets/'+readdirSync('dist/assets').find(n=>n.endsWith('.css')));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?result.outputFiles[0].text:req.url==='/style.css'?css:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
let passed=0;
try {
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]) for(const variant of ['page','modal']) {
    const page=await browser.newPage({viewport}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#${variant}`);
    await page.getByText('שאלה: 320',{exact:true}).waitFor();
    const scroll=page.getByTestId('search-scroll');
    for(const query of ['', 'בדיקה']) {
      await page.getByPlaceholder(/חפש שאלות/).fill(query);
      await page.getByText('שאלה: 320',{exact:true}).waitFor();
      await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.locator('[data-search-result="card:319"]').waitFor();
      assert.ok(await page.locator('[data-search-result]').count()<40,'bounded virtual DOM');
    }
    await page.getByLabel('מקור השאלות').selectOption('shemesh');
    await page.getByText('שאלה: 160',{exact:true}).waitFor();
    await page.locator('[data-search-result="card:0"]').waitFor();
    await page.getByRole('button',{name:'פתח בתרגול: בדיקה 0',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.body.dataset.practiceCard),'0');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
    assert.deepEqual(errors,[]); passed++; await page.close();
  }
  console.log(JSON.stringify({passed,failed:0,scenarios:'desktop/mobile x page/modal; browse/search beyond 200; source filter resets scroll; bounded DOM; no overflow/page errors'}));
} finally {await browser.close();server.close();}
