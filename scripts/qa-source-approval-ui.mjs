import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const app=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QuestionSourcePicker} from './src/components/admin/QuestionSourcePicker';import {SourceApprovalControls} from './src/components/admin/SourceApprovalControls';window.calls=[];function App(){const [ids,setIds]=useState([]);const [stats,setStats]=useState({approved_count:0,pending_count:3518,hidden_count:2,auto_approve:false});return <QuestionSourcePicker sources={['yeshiva']} counts={{yeshiva:3520}} selected={ids} onChange={setIds} renderActions={id=><SourceApprovalControls id={id} stats={stats} onRefresh={async()=>setStats({...stats,approved_count:3518,pending_count:0})}/>}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',plugins:[{name:'isolated-cloud',setup(b){b.onResolve({filter:/integrations\/supabase\/client/},()=>({path:'cloud',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const supabase={rpc:async(name,args)=>{window.calls.push({name,args});return {data:Math.min(100,Math.max(0,3518-(window.calls.length-1)*100)),error:null}}};`,loader:'js'}));}}]});
const css=readFileSync('dist/assets/'+readdirSync('dist/assets').find(n=>n.endsWith('.css')));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?app.outputFiles[0].text:req.url==='/style.css'?css:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:/מקורות השאלות/}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'אשר את כל הממתינות'}).click();
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
  await page.getByRole('button',{name:'סגור',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByRole('button',{name:'אשר את כל הממתינות'}).click();await page.getByRole('button',{name:'אישור הפעולה'}).click();
  await page.getByText('ממתינות: 0',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.length),37);
  assert.ok(await page.evaluate(()=>window.calls.every(c=>c.name==='admin_approve_question_source'&&c.args.p_source_id==='yeshiva')));
  assert.equal(await page.locator('[role=checkbox][data-state=checked]').count(),0);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('3 source approval UI scenarios passed (320,390,1280), isolated local HTTP fixture');
}finally{await browser.close();server.close();}
