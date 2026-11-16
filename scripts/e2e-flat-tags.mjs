import { runBatchTabMoveScenarios } from './e2e-batch-tab-move.mjs';
import assert from 'node:assert/strict';

// Shared by preview and real-extension smoke runs. Seed the previous schema,
// then exercise actual panel controls instead of calling implementation helpers.
export async function runFlatTagScenarios({ client, evaluate, waitFor, drag, fixtureUrl }) {
  const io = "const extension = Boolean(chrome?.runtime?.id);"
    + "const read = async () => extension ? (await chrome.storage.local.get('spaceTabsState')).spaceTabsState : JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState;"
    + "const write = async (state) => extension ? chrome.storage.local.set({spaceTabsState:state}) : localStorage.setItem('spaceTabsState', JSON.stringify({spaceTabsState:state}));";
  const run = (code) => evaluate(client, "(async () => {" + io + code + "})()");
  const check = async (code) => waitFor(client, "(async () => {" + io + code + "})()", 15000);
  const reload = async () => {
    await client.send('Page.reload', { ignoreCache: true });
    await waitFor(client, "document.documentElement.dataset.initialized === 'true'", 15000);
  };
  const card = (key) => '.group-card[data-group-key=' + JSON.stringify(key) + ']';
  const fixture = await run(
    "const {createDefaultState} = await import('./src/shared/state.js');"
    + "const state = createDefaultState();"
    + "state.version = 12; state.browserSessionId=(await read())?.browserSessionId || '';"
    + "state.spaces.push({id:'flat-target',name:'Flat Target',icon:'F',color:'green'});"
    + "let ids = [7,9]; let tabIds = [101,102];"
    + "if (extension) {"
    + " const first = await chrome.tabs.create({url:'https://example.com/flat-first',active:false});"
    + " const second = await chrome.tabs.create({url:'https://example.com/flat-second',active:false});"
    + " tabIds=[first.id,second.id];"
    + " ids=[await chrome.tabs.group({tabIds:[first.id]}),await chrome.tabs.group({tabIds:[second.id]})];"
    + " await chrome.tabGroups.update(ids[0],{title:'Flat Parent',color:'blue'});"
    + " await chrome.tabGroups.update(ids[1],{title:'Flat Child',color:'green'});"
    + " await chrome.storage.session.remove('spaceTabsWindowState');"
    + "} else {"
    + " sessionStorage.setItem('spaceTabsPreviewRuntime',JSON.stringify({tabs:tabIds.map((id,index)=>({id,title:index?'Second Page':'First Page',url:'https://example.com/flat-'+index,groupId:ids[index],windowId:1,index,active:index===0})),"
    + " groups:[{id:ids[0],title:'Flat Parent',color:'blue'},{id:ids[1],title:'Flat Child',color:'green'}]}));"
    + " sessionStorage.removeItem('spaceTabsWindowState');"
    + "}"
    + "state.groupSpaces = {[ids[0]]:'default',[ids[1]]:'default'};"
    + "state.emptyNodes = {default:{'node:parent':{title:'Empty Parent',color:'blue'},'node:child':{title:'Empty Child',color:'green'}}};"
    + "state.groupParents = {default:{['group:'+ids[1]]:'group:'+ids[0],'node:child':'node:parent','sgid:flat-saved':'group:'+ids[0]}};"
    + "state.collapsedGroups = {'node:parent':true}; state.collapsedSpaceGroups={default:true};"
    + "state.groupOrder={default:['group:'+ids[1],'group:'+ids[0],'node:parent','node:child']};"
    + "state.spaceSnapshots={default:{version:1,groups:[{title:'Work / Docs',color:'purple',collapsed:true,snapshotGroupId:'flat-saved',tabs:[{title:'Saved Reference',url:'https://example.com/flat-saved',snapshotTabId:'flat-saved-tab'}]}]}};"
    + "await write(state); return {parent:'group:'+ids[0],child:'group:'+ids[1],tabIds};"
  );
  await reload();
  const flat = await check(
    "const state=await read(); const cards=[...document.querySelectorAll('#groupsList > .group-card')];"
    + "const titles=cards.map(card=>card.querySelector('h2')?.textContent);"
    + "return ['Flat Parent','Flat Child','Empty Parent','Empty Child','Work / Docs'].every(title=>titles.includes(title))"
    + " && !Object.hasOwn(state,'groupParents') && !document.querySelector('.group-children') ? {titles,version:state.version} : null;"
  );
  assert.equal(flat.version, 13);
  const liveHeader = card(fixture.parent) + ' > .group-header';
  await run("document.querySelector(" + JSON.stringify(liveHeader) + ").click();");
  await check("return document.querySelector(" + JSON.stringify(card(fixture.parent) + ' .tab-row') + ") && !document.querySelector('#collapseGroupsButton').classList.contains('active');");
  const otherCollapsed = await run("return document.querySelector(" + JSON.stringify(card(fixture.child)) + ").classList.contains('collapsed');");
  assert.equal(otherCollapsed, true);
  await run("document.querySelector('#collapseGroupsButton').click();");
  await check("return document.querySelector('#collapseGroupsButton').classList.contains('active') && document.querySelectorAll('#groupsList > .group-card .tab-row').length===0;");
  const tabCountBeforeExpand = await run("return extension ? (await chrome.tabs.query({})).length : JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime')).tabs.length;");
  await run("document.querySelector('#collapseGroupsButton').click();");
  await check("return !document.querySelector('#collapseGroupsButton').classList.contains('active') && [...document.querySelectorAll('#groupsList > .group-card')].every(card=>!card.classList.contains('collapsed')) && [...document.querySelectorAll('#groupsList > .group-card .tab-row')].some(row=>row.textContent.includes('Saved Reference'));");
  const tabCountAfterExpand = await run("return extension ? (await chrome.tabs.query({})).length : JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime')).tabs.length;");
  assert.equal(tabCountAfterExpand, tabCountBeforeExpand);
  await reload();
  await check("return [...document.querySelectorAll('#groupsList > .group-card')].every(card=>!card.classList.contains('collapsed')) && document.querySelectorAll('#groupsList > .group-card .tab-row').length>=3;");
  await run("document.querySelector('#collapseGroupsButton').click();");
  await check("return document.querySelector('#collapseGroupsButton').classList.contains('active');");
  await run("const header=[...document.querySelectorAll('.group-header')].find(header=>header.querySelector('h2')?.textContent==='Work / Docs'); header.click();");
  await check("return !document.querySelector('#collapseGroupsButton').classList.contains('active') && [...document.querySelectorAll('.tab-row.dormant')].some(row=>row.textContent.includes('Saved Reference'));");
  const tabCountAfterSavedExpand = await run("return extension ? (await chrome.tabs.query({})).length : JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime')).tabs.length;");
  assert.equal(tabCountAfterSavedExpand, tabCountBeforeExpand);
  await run("document.querySelector('#collapseGroupsButton').click();");
  await check("return document.querySelector('#collapseGroupsButton').classList.contains('active');");
  await run("document.querySelector('#collapseGroupsButton').click();");
  await check("return !document.querySelector('#collapseGroupsButton').classList.contains('active') && [...document.querySelectorAll('#groupsList > .group-card')].every(card=>!card.classList.contains('collapsed'));");
  // A failed display checkpoint must restore both the rows and native groups.
  await run("window.__flatDisclosureWriteFailed=false; if(extension) { const original=chrome.storage.local.set; chrome.storage.local.set=async function(values,...rest) { if(!window.__flatDisclosureWriteFailed && values.spaceTabsState) { window.__flatDisclosureWriteFailed=true; throw Error('Flat disclosure checkpoint failure'); } return original.call(this,values,...rest); }; window.__restoreFlatDisclosureWrite=()=>{chrome.storage.local.set=original;}; } else { const original=Storage.prototype.setItem; Storage.prototype.setItem=function(key,value) { if(this===localStorage && key==='spaceTabsState' && !window.__flatDisclosureWriteFailed) { window.__flatDisclosureWriteFailed=true; throw Error('Flat disclosure checkpoint failure'); } return original.call(this,key,value); }; window.__restoreFlatDisclosureWrite=()=>{Storage.prototype.setItem=original;}; } document.querySelector('#collapseGroupsButton').click();");
  await check("return window.__flatDisclosureWriteFailed && !document.querySelector('#collapseGroupsButton').disabled && !document.querySelector('#collapseGroupsButton').classList.contains('active') && [...document.querySelectorAll('#groupsList > .group-card')].every(card=>!card.classList.contains('collapsed'));");
  const nativeRollback = await run("window.__restoreFlatDisclosureWrite(); const nativeGroups=extension ? await chrome.tabGroups.query({}) : JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime')).groups; return nativeGroups.filter(group=>['Flat Parent','Flat Child'].includes(group.title)).every(group=>!group.collapsed);");
  assert.equal(nativeRollback,true);
  const before = await run("const state=await read(); return state.spaceSnapshots.default.groups.find(g=>g.snapshotGroupId==='flat-saved');");
  const source = card(fixture.child) + ' > .group-header';
  const target = card(fixture.parent) + ' > .group-header';
  if (drag) {
    await drag(client, source, target, { targetYRatio: 0.6 });
  } else {
    await run("const source=document.querySelector(" + JSON.stringify(source) + ");"
      + "const target=document.querySelector(" + JSON.stringify(target) + ");"
      + "const transfer=new DataTransfer(); const rect=target.getBoundingClientRect();"
      + "source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));"
      + "target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+rect.height*0.6}));"
      + "target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+rect.height*0.6}));");
  }
  await check("const state=await read(); return !Object.hasOwn(state,'groupParents') && state.groupOrder.default.indexOf("
    + JSON.stringify(fixture.child) + ")===state.groupOrder.default.indexOf(" + JSON.stringify(fixture.parent) + ")+1;");
  await run("const header=document.querySelector(" + JSON.stringify(target) + ");"
    + "header.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));");
  const menu = await run("return document.querySelector('#contextMenu').textContent;");
  assert.ok(!menu.includes('Subgroup'));
  await run("document.body.click();");
  await run("document.querySelector(" + JSON.stringify(card('node:parent') + ' [aria-label="Rename group"]') + ").click();");
  await waitFor(client, "document.querySelector('#actionDialog')?.open");
  await run("document.querySelector('#actionDialogInput').value='Empty Renamed'; document.querySelector('#actionDialogConfirm').click();");
  await check("const state=await read(); return state.emptyNodes.default['node:parent']?.title==='Empty Renamed';");
  await reload();
  await check("return document.querySelector(" + JSON.stringify(card('node:parent') + ' h2') + ")?.textContent==='Empty Renamed';");
  await run("document.querySelector(" + JSON.stringify(card('node:parent') + ' [aria-label="Delete group"]') + ").click();");
  await check("const state=await read(); return !state.emptyNodes.default?.['node:parent'] && state.emptyNodes.default?.['node:child'] && document.querySelector(" + JSON.stringify(card('node:child')) + ");");
  const after = await run("const state=await read(); return state.spaceSnapshots.default.groups.find(g=>g.snapshotGroupId==='flat-saved');");
  assert.deepEqual(after, before);
  await run("document.querySelector(" + JSON.stringify(target) + ").dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));");
  await run("const button=[...document.querySelectorAll('#contextMenu button')].find(button=>button.textContent.trim()==='Flat Target'); if(!button) throw Error('Missing move destination'); button.click();");
  await check("const state=await read(); const source=state.spaceSnapshots.default?.groups||[]; const target=state.spaceSnapshots['flat-target']?.groups||[]; return source.some(group=>group.title==='Flat Child') && !source.some(group=>group.title==='Flat Parent') && target.some(group=>group.title==='Flat Parent') && !target.some(group=>group.title==='Flat Child');");
  await run("document.querySelector('.space[data-space-id=\"default\"]').click();");
  await waitFor(client, "document.querySelector('#activeSpaceName')?.textContent==='Default'");
  await run("const button=[...document.querySelectorAll('#groupsList button')].find(button=>button.textContent.includes('New Group')); if(!button) throw Error('Missing New Group'); button.click();");
  await waitFor(client, "document.querySelector('#actionDialog')?.open");
  await run("document.querySelector('#actionDialogInput').value='Created Flat Tag'; document.querySelector('#actionDialogConfirm').click();");
  await check("const state=await read(); return Object.values(state.emptyNodes.default||{}).some(node=>node.title==='Created Flat Tag') && !Object.hasOwn(state,'groupParents');");
  const batchChecks = await runBatchTabMoveScenarios({ client, evaluate, waitFor, drag, fixtureUrl });
  return { ok: true, checks: [...batchChecks, 'legacy upgrade', 'flat rendering', 'expand one after collapse all', 'expand all live and saved rows', 'expansion survives reload without opening tabs', 'saved-only expansion does not restore tabs', 'display checkpoint rolls back native groups', 'slash titles', 'drag sorting', 'no subgroup menu', 'empty rename', 'reload', 'independent deletion', 'independent Space move', 'new Tag'] };
}
