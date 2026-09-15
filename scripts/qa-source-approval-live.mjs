// Read-only navigation in an isolated browser. No approval, settings or profile writes.
import fs from 'node:fs';
import {chromium} from '@playwright/test';
const runner=fs.readFileSync('scripts/run-migration.mjs','utf8');
const value=name=>runner.match(new RegExp('const '+name+' = (?:process.env.[A-Z_]+ \\|\\| )?[\\x27\\x22]([^\\x27\\x22]+)'))?.[1];
if(value('SUPABASE_URL')!=='https://elfxevuxhffxskooppca.supabase.co')throw Error('Unexpected backend');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.setDefaultTimeout(15000);
 await page.goto('http://localhost:5000/auth');
 const ok=await page.evaluate(async creds=>{const {supabase}=await import('/src/integrations/supabase/client.ts');const {error}=await supabase.auth.signInWithPassword(creds);return !error;},{email:process.env.ADMIN_EMAIL||value('ADMIN_EMAIL'),password:process.env.ADMIN_PASSWORD||value('ADMIN_PASSWORD')});
 if(!ok)throw Error('Authentication failed');
 let catalogRequests=0;page.on('request',r=>{if(r.url().includes('/rpc/get_admin_question_source_tags'))catalogRequests++;});
 await page.goto('http://localhost:5000/');
 await page.getByText('ניהול משתמשים',{exact:true}).first().click({timeout:60000});
 if(catalogRequests!==0)throw Error('Hidden profiles loaded source catalog');
 await page.getByRole('tab',{name:'גישה ותפקידים',exact:true}).click();
 const close=page.getByText('סגור להפעם — יופיע שוב בכניסה הבאה',{exact:true});if(await close.isVisible())await close.click();
 if(await page.getByRole('button',{name:'אשר את כל הממתינות',exact:true}).count())throw Error('Approval controls remain in profile');
 await page.getByRole('button',{name:'לניהול אישור שאלות ומקורות',exact:true}).click();
 await page.getByRole('button',{name:'אשר את כל הממתינות',exact:true}).first().waitFor({timeout:30000});
 const approvalPanel=page.getByRole('tabpanel').filter({has:page.getByRole('heading',{name:'אישור שאלות ומקורות',exact:true})}).last();
 for(let i=0;i<3;i++){const before=catalogRequests;await page.getByRole('button',{name:'רענן מקורות',exact:true}).click();await page.getByRole('status').filter({hasText:'טוען מקורות'}).waitFor({state:'hidden',timeout:30000});if(catalogRequests!==before+1)throw Error('Refresh not single request');if(await approvalPanel.getByRole('alert').count())throw Error('Refresh failed: '+await approvalPanel.getByRole('alert').innerText());}
 console.log(JSON.stringify({url:page.url(),approvalButtons:await page.getByRole('button',{name:'אשר את כל הממתינות',exact:true}).count(),yeshivaVisible:await page.getByText('מאגר הישיבה',{exact:true}).isVisible()}));
 await page.getByLabel('חיפוש מקור לאישור').fill('מאגר הישיבה');
 if(await page.getByRole('button',{name:'אשר את כל הממתינות',exact:true}).count()!==1)throw Error('Source search failed');
 await page.getByRole('tab',{name:'גישה ותפקידים',exact:true}).click();
 await page.getByRole('button',{name:'לניהול אישור שאלות ומקורות',exact:true}).click();
 await page.getByRole('button',{name:'אשר את כל הממתינות',exact:true}).first().waitFor({timeout:30000});
 await page.setViewportSize({width:390,height:844});
 if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('Mobile horizontal overflow');
 console.log('PASS: profile shortcut, standalone approval tab, search, return navigation and mobile width; no approval performed');
}finally{await browser.close();}
