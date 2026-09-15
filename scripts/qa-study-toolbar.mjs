import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const mocks={
 '@/lib/study/store':`window.qaReviews=[];window.qaResults=[];const cards=Array.from({length:5},(_,i)=>({id:String(i),question:'שאלת בדיקה '+i,type:'combo',answer:'תשובה',options:['א','ב'],correctIndices:[0],tags:['cat:ברכות'],srs:{},stats:{}}));export const useStudy=()=>({state:{cards,decks:[],categories:[{id:'cat',name:'ברכות'}],uiPrefs:{}},setUiPref:()=>{},reviewCard:(...args)=>window.qaReviews.push(args),addPracticeResult:r=>window.qaResults.push(r),addCardToDeck:()=>{}});`,
 './CardQuickEditor':'export const CardQuickEditor=()=>null;',
 './CardDecksDialog':'export const CardDecksDialog=()=>null;',
 './QuestionReportDialog':'export const QuestionReportDialog=()=>null;',
};
const result=await build({stdin:{contents:`import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {StudySession} from './src/components/study/StudySession';function App(){const [tick,setTick]=useState(0);useEffect(()=>{const t=setInterval(()=>setTick(n=>n+1),100);return()=>clearInterval(t)},[]);return <StudySession mode="practice" deckId={null} cardIds={['0','1','2','3','4']} onExit={()=>{}}/>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
const css=readFileSync('dist/assets/'+readdirSync('dist/assets').find(n=>n.endsWith('.css')));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:req.url==='/style.css'?css:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{for(const width of [390,430]){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const toolbar=page.getByTestId('mobile-study-toolbar');await toolbar.waitFor();
 const buttons=await toolbar.locator('button').evaluateAll(els=>els.map(e=>{const b=e.getBoundingClientRect();return {w:b.width,h:b.height,r:getComputedStyle(e).borderRadius}}));
 assert.equal(buttons.length,5);for(const b of buttons){assert.ok(b.w>=36);assert.equal(b.w,b.h);assert.equal(b.w,buttons[0].w);assert.equal(b.r,buttons[0].r);}
 for(const name of ['study-question-counter','study-session-time']){
  const metric=await page.getByTestId(name).evaluate(e=>({height:e.getBoundingClientRect().height,radius:getComputedStyle(e).borderRadius}));
  assert.equal(metric.height,buttons[0].h);assert.equal(metric.radius,buttons[0].r);
 }
 const settingsBox=await page.getByRole('button',{name:'הגדרות תרגול'}).boundingBox();
 assert.ok(settingsBox.x<30,'settings aligned near the left edge');
 assert.ok(await page.getByTestId('study-question-type').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)<=10));
 assert.equal(await page.getByRole('button',{name:'יציאה מהתרגול'}).textContent(),'');
 const crumb=await page.getByTestId('study-question-breadcrumb').boundingBox(),type=await page.getByTestId('study-question-type').boundingBox();assert.ok(crumb.x>type.x+type.width);
 const question=page.getByText(/^שאלת בדיקה \d$/).first();const first=await question.textContent();
 for(let i=0;i<20;i++){await page.waitForTimeout(100);assert.equal(await question.textContent(),first);}
 for(let index=0;index<5;index++){
  assert.ok((await toolbar.textContent()).includes(`${index+1}/5`));
  const before=await question.textContent();
  const option=page.getByText(index%2===0?'א':'ב',{exact:true}).last().locator('xpath=ancestor::button[1]');
  const beforeBox=await option.boundingBox();
  await page.getByText(index%2===0?'א':'ב',{exact:true}).last().click();
  await page.waitForTimeout(250);
  const afterBox=await option.boundingBox();
  assert.ok(Math.abs(beforeBox.height-afterBox.height)<1,'answer height stays unchanged after feedback');
  assert.ok(Math.abs(beforeBox.y-afterBox.y)<1,'answer position stays unchanged after feedback');
  assert.equal(await page.getByText(/ראה גם את התשובה המלאה/).count(),0);
  assert.equal(await question.textContent(),before,'feedback remains visible before advancing');
  await page.waitForFunction(n=>window.qaReviews.length===n,index+1,{timeout:4000});
  if(index<4){
   assert.notEqual(await question.textContent(),before);
   const after=await question.textContent();
   await page.waitForTimeout(1200);
   assert.equal(await question.textContent(),after,'one answer must advance exactly once');
  }
 }
 await page.waitForFunction(()=>window.qaResults.length===1);
 await page.waitForTimeout(1200);
 const saved=await page.evaluate(()=>({reviews:window.qaReviews,results:window.qaResults}));
 assert.equal(saved.results.length,1);assert.equal(saved.reviews.length,5);
 assert.equal(new Set(saved.reviews.map(r=>r[0])).size,5);
 assert.equal(saved.results[0].total,5);assert.equal(saved.results[0].correct,3);
 assert.equal(saved.results[0].answers.length,5);assert.equal(saved.results[0].completed,true);
 const report=page.getByTestId('study-results');
 for(const reportWidth of [width,320]){
  await page.setViewportSize({width:reportWidth,height:844});
  await page.waitForTimeout(200);
  const dimensions=await report.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,overflow:getComputedStyle(e).overflowY,font:getComputedStyle(e).fontFamily,headingFont:getComputedStyle(e.querySelector('h3')).fontFamily}));
  assert.ok(dimensions.scroll<=dimensions.width,'results have no horizontal overflow');
  assert.equal(dimensions.overflow,'auto');assert.equal(dimensions.font,dimensions.headingFont);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.doesNotMatch(await report.textContent(),/[🐢⚡]/u);
 }
 assert.deepEqual(errors,[]);await page.close();
}console.log('2 complete mobile sessions passed: 10 answers, stable refresh, exact-once advancement and result saving');}finally{await browser.close();server.close();}
