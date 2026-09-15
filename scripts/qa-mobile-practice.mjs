import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const store=`const card={id:'q',question:'שאלת בדיקה',answer:'תשובה',type:'multiple',tags:[],masechta:'ברכות',daf:2,amud:1,srs:{},stats:{}};export const useStudy=()=>({state:{cards:[card],decks:[],categories:[],uiPrefs:{dafLearningLayout:'split',dafLearningNavigationView:'drilldown'}},setUiPref:()=>{},updateCard:()=>{}});`;
const mocks={
 '@/lib/study/store':store,
 '@/hooks/usePermissions':'export const usePermissions=()=>({isAdmin:true,can:()=>true});',
 'react-router-dom':'export const useNavigate=()=>()=>{};export const useLocation=()=>({pathname:"/"});',
};
const children={GemaraViewer:'<div data-testid="gemara">גמרא</div>',StudySession:'<div>תרגול פעיל</div>',CardQuickEditor:'<div data-testid="editor">עריכה</div>',CardDecksDialog:'null',BulkCardDecksDialog:'null',CardEditor:'null',MishnaLearningTab:'null',ChumashLearningTab:'null',NeviimKetuvimLearningTab:'null',PageProgressDialog:'null'};
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {DafLearningTab} from './src/components/study/DafLearningTab';createRoot(document.getElementById('root')).render(<><div style={{height:900}}>ראש העמוד</div><DafLearningTab/></>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/.*/},args=>{
   if(mocks[args.path])return {path:args.path,namespace:'fixture'};
   const name=args.path.split('/').pop();
   if(children[name]!==undefined)return {path:name,namespace:'child'};
   if(name==='ShasProgressViews')return {path:'PageProgressDialog',namespace:'child'};
 });
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'child'},args=>({contents:`import React from 'react';export const ${args.path}=()=>${children[args.path]};`,loader:'jsx',resolveDir:process.cwd()}));
}}]});
const css=readFileSync('dist/assets/'+readdirSync('dist/assets').find(n=>n.endsWith('.css')));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:req.url==='/style.css'?css:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 for(const width of [390,430]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,locale:'he-IL'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:/תרגול כללי/}).tap();
  assert.ok(Math.abs(await page.getByRole('region',{name:'בחירת סוג תרגול'}).evaluate(e=>e.getBoundingClientRect().top))<3);
  await page.getByRole('button',{name:/זרעים 1 מסכתות/}).tap();
  await page.getByRole('button',{name:'ברכות',exact:true}).tap();
  await page.getByTestId('inline-daf-2-count').tap();
  await page.getByTestId('inline-amud-1').tap();
  const add=page.getByRole('button',{name:'הוספת שאלות לעמוד זה'});
  const practice=page.getByRole('button',{name:'תרגול',exact:true});
  const a=await add.boundingBox(),p=await practice.boundingBox();
  assert.ok(p.y>=a.y+a.height,'practice below tools');
  const actions=await page.getByTestId('daf-question-tools').boundingBox();
  assert.ok(p.width>=actions.width-2,'practice fills its own row');
  const progress=await page.getByRole('button',{name:'התקדמות לעמוד זה'}).boundingBox();
  const count=await page.getByTestId('daf-question-count').boundingBox();
  assert.ok(Math.abs(a.y-progress.y)<8&&Math.abs(a.y+a.height/2-count.y-count.height/2)<8,'top row aligned');
  assert.ok(count.x>=actions.x&&a.x+a.width<=actions.x+actions.width+1,'tools fit mobile width');
  assert.equal(await page.getByTestId('daf-question-count').textContent(),'(1)');
  assert.equal(await page.getByRole('button',{name:/ערוך שאלה:/}).count(),0);
  assert.equal(await page.getByRole('button',{name:'בחר תצוגת שאלות וטקסט'}).isVisible(),false);
  const list=page.getByTestId('daf-question-list');const gemara=page.getByTestId('gemara');
  assert.ok((await gemara.boundingBox()).y>(await list.boundingBox()).y,'gemara below questions despite saved split');
  const row=page.getByText('שאלת בדיקה',{exact:true});
  await row.dispatchEvent('pointerdown',{pointerType:'touch',clientX:10,clientY:10});
  await row.dispatchEvent('pointermove',{pointerType:'touch',clientX:10,clientY:40});
  await page.waitForTimeout(700);assert.equal(await page.getByTestId('editor').count(),0);
  await row.dispatchEvent('pointerdown',{pointerType:'touch',clientX:10,clientY:10});
  await page.getByTestId('editor').waitFor();assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('2 mobile practice scenarios passed: alignment, fixed layout, compact actions, hidden edit, hold/move');
}finally{await browser.close();server.close();}
