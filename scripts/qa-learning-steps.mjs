import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const app = await build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LearningStepNavigator} from './src/components/study/LearningStepNavigator';function App(){const [ready,setReady]=useState(false);return <LearningStepNavigator confirmed={ready} onConfirmedChange={setReady} steps={['סדר','מסכת','פרק','משנה'].map((title,i)=>({title:'בחר '+title,backLabel:title,options:Array.from({length:i===2?40:6},(_,n)=>({value:String(n),label:title+' '+n})),onSelect:()=>{}}))}/>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', tsconfig: 'tsconfig.app.json' });
const css = readFileSync('dist/assets/' + readdirSync('dist/assets').find(n => n.endsWith('.css')));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/app.js' ? app.outputFiles[0].text : req.url === '/style.css' ? css : '<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const row = await page.getByRole('button', { name: 'סדר 0', exact: true }).evaluate(button => {
      const boxes = [...button.parentElement.children].map(node => node.getBoundingClientRect());
      const first = boxes.filter(box => Math.abs(box.top - boxes[0].top) < 2);
      return { left: Math.min(...first.map(b => b.left)), right: Math.max(...first.map(b => b.right)), width: innerWidth };
    });
    assert.ok(Math.abs((row.left + row.right) / 2 - row.width / 2) < 2, 'cards are centered');
    for (const name of ['סדר 0', 'מסכת 0', 'פרק 0', 'משנה 0']) {
      const button = page.getByRole('button', { name, exact: true });
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      await button.click();
      assert.equal(await page.getByLabel('בחירה שלב אחר שלב').evaluate(el => el.style.minHeight), '', 'previous step must not reserve empty space');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.equal(await page.getByRole('button', { name: 'משנה 0', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'חזרה לפרק', exact: true }).click();
    await page.getByRole('button', { name: 'פרק 1', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'משנה 0', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('3 passed, 0 failed: step navigation, explicit selection, backtracking, no horizontal overflow at 320/390/1280; isolated local HTTP fixture');
} finally { await browser.close(); server.close(); }
