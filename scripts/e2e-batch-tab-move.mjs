import assert from 'node:assert/strict';

export async function runBatchTabMoveScenarios({ client, evaluate, waitFor, drag, fixtureUrl }) {
  const io = "const extension=Boolean(chrome?.runtime?.id);"
    + "const read=async()=>extension?(await chrome.storage.local.get('spaceTabsState')).spaceTabsState:JSON.parse(localStorage.getItem('spaceTabsState')||'{}').spaceTabsState;"
    + "const write=async(state)=>extension?chrome.storage.local.set({spaceTabsState:state}):localStorage.setItem('spaceTabsState',JSON.stringify({spaceTabsState:state}));"
    + "const runtimeTabs=async()=>extension?chrome.tabs.query({}):JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime')).tabs;";
  const run = (code) => evaluate(client, "(async()=>{" + io + code + "})()");
  const check = async (code) => {
    try { return await waitFor(client, "(async()=>{" + io + code + "})()", 15000); }
    catch (error) {
      const detail = await run("const state=await read();return {rows:[...document.querySelectorAll('.tab-row')].map(row=>({id:row.dataset.tabId,key:row.dataset.groupKey,title:row.textContent,selected:row.classList.contains('selected')})),order:state.tabOrder,toast:document.querySelector('#workbenchToast')?.textContent,runtime:await runtimeTabs()};");
      throw new Error(error.message + ' Diagnostics: ' + JSON.stringify(detail));
    }
  };
  const fixture = await run(
    "const pageUrl=" + JSON.stringify(fixtureUrl || 'https://example.com/batch') + ";const {createDefaultState}=await import('./src/shared/state.js'); const state=createDefaultState();"
    + "state.browserSessionId=(await read())?.browserSessionId||'';"
    + "let ids=[201,202,203,204,205]; let source=17; let target=19;"
    + "if(extension){ ids=[]; for(let index=0;index<5;index++) ids.push((await chrome.tabs.create({url:pageUrl+'?batch='+index,active:false})).id);"
    + "source=await chrome.tabs.group({tabIds:ids.slice(0,3)});target=await chrome.tabs.group({tabIds:[ids[3]]});"
    + "await chrome.tabGroups.update(source,{title:'Batch Source',color:'blue',collapsed:false});"
    + "await chrome.tabGroups.update(target,{title:'Batch Target',color:'green',collapsed:false});"
    + "await chrome.storage.session.remove('spaceTabsWindowState');"
    + "}else{sessionStorage.setItem('spaceTabsPreviewRuntime',JSON.stringify({tabs:ids.map((id,index)=>({id,title:'Batch '+index,url:pageUrl+'?batch='+index,groupId:index<3?source:index===3?target:-1,windowId:1,index,active:false})),groups:[{id:source,title:'Batch Source',color:'blue'},{id:target,title:'Batch Target',color:'green'}]}));sessionStorage.removeItem('spaceTabsWindowState');}"
    + "state.renamedTabs={[ids[0]]:'Batch alias'};state.tabSpaces={[ids[4]]:'default'};state.groupSpaces={[source]:'default',[target]:'default'};"
    + "state.emptyNodes={default:{'node:batch':{title:'Batch Empty',color:'purple'}}};"
    + "state.spaceSnapshots={default:{version:1,groups:[{title:'Batch Saved',snapshotGroupId:'batch-saved',color:'orange',tabs:[{title:'Saved anchor',url:'https://example.com/batch-saved',snapshotTabId:'batch-saved-row'}]}]}};"
    + "state.collapsedGroups={'snapshot:0:default:batch-saved':false}; await write(state);return {ids,source,target};"
  );
  await check("const tabs=await runtimeTabs();return !extension || " + JSON.stringify(fixture.ids) + ".every(id=>tabs.find(tab=>tab.id===id)?.status==='complete');");
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, "document.documentElement.dataset.initialized==='true'", 15000);
  await check("return " + JSON.stringify(fixture.ids) + ".every(id=>document.querySelector('.tab-row[data-tab-id=\"'+id+'\"]'));");
  // Instrument the public runtime transport, so grouping must carry the full
  // selection in one request rather than replaying the single-tab operation.
  await run("if(extension){const original=chrome.runtime.sendMessage;window.__batchCommands=[];chrome.runtime.sendMessage=function(message,...rest){window.__batchCommands.push(structuredClone(message));return original.call(this,message,...rest);};}");
  const selected = fixture.ids.slice(0, 2);
  const row = (id) => '.tab-row[data-tab-id="' + id + '"]';
  const select = async () => {
    await run("document.querySelector(" + JSON.stringify(row(selected[0]) + ' .tab-main-button') + ").dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));"
      + "document.querySelector(" + JSON.stringify(row(selected[1]) + ' .tab-main-button') + ").dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));");
    const actual = await run("return [...document.querySelectorAll('.tab-row.selected')].map(row=>Number(row.dataset.tabId));");
    assert.deepEqual(actual, selected);
  };
  const drop = async (targetSelector, before = false) => {
    const sourceSelector = row(selected[0]);
    await run("if(extension)window.__batchCommands=[];else window.__SPACE_TABS_PREVIEW_COMMANDS__=[];");
    if (drag) await drag(client, sourceSelector, targetSelector, { targetYRatio: before ? 0.2 : 0.6 });
    else await run("const source=document.querySelector(" + JSON.stringify(sourceSelector) + ");const target=document.querySelector(" + JSON.stringify(targetSelector) + ");"
      + "const transfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));"
      + "target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));"
      + "target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));"
      + "source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));");
  };
  const batchCommands = () => run("return extension?window.__batchCommands:(window.__SPACE_TABS_PREVIEW_COMMANDS__||[]).map(entry=>({type:entry.type,...entry.payload}));");
  const targetHeader = '.group-card[data-group-key="group:' + fixture.target + '"] > .group-header';
  await select();
  await drop(targetHeader);
  await check("const tabs=await runtimeTabs();return " + JSON.stringify(selected) + ".every(id=>tabs.find(tab=>tab.id===id)?.groupId===" + fixture.target + ") && tabs.find(tab=>tab.id===" + fixture.ids[2] + ")?.groupId===" + fixture.source + " && document.querySelectorAll('.group-card[data-group-key=\"group:" + fixture.target + "\"] .tab-row.selected').length===2;");
  const retained = await run("const state=await read();const live=await runtimeTabs();const rows=Object.values(state.spaceSnapshots||{}).flatMap(snapshot=>(snapshot.groups||[]).flatMap(group=>group.tabs||[]));return {alias:document.querySelector(" + JSON.stringify(row(selected[0]) + ' .tab-title') + ")?.textContent,counts:" + JSON.stringify(selected) + ".map(id=>rows.filter(row=>row.url===live.find(tab=>tab.id===id)?.url).length)};");
  assert.equal(retained.alias, 'Batch alias');
  assert.deepEqual(retained.counts, [1, 1]);
  const calls = (await batchCommands()).filter((message) => message.type === 'tabs:groupExisting');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tabIds, selected);
  // Drop before a row in the same group: both selected rows stay together.
  await drop(row(fixture.ids[3]), true);
  await check("const ids=[...document.querySelectorAll('.group-card[data-group-key=\"group:" + fixture.target + "\"] .tab-row')].map(row=>Number(row.dataset.tabId));return JSON.stringify(ids)===JSON.stringify(" + JSON.stringify([...selected, fixture.ids[3]]) + ");");
  const nativeOrder = await run("return (await runtimeTabs()).filter(tab=>tab.groupId===" + fixture.target + ").sort((a,b)=>a.index-b.index).map(tab=>tab.id);");
  assert.deepEqual(nativeOrder, [...selected, fixture.ids[3]]);
  // Empty destination creates exactly one Chrome group for the selection.
  await drop('.group-card[data-group-key="node:batch"] > .group-header');
  const emptyGroupId = await check("const tabs=await runtimeTabs();const first=tabs.find(tab=>tab.id===" + selected[0] + ");return first?.groupId>=0 && first.groupId!==" + fixture.target + " && tabs.find(tab=>tab.id===" + selected[1] + ")?.groupId===first.groupId ? {id:first.groupId}:null;");
  const created = (await batchCommands()).filter((message) => message.type === 'tabs:group');
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].tabIds, selected);
  // Dragging onto Ungrouped removes group membership for the entire selection.
  await drop('.ungrouped-section .ungrouped-list');
  await check("const tabs=await runtimeTabs();return " + JSON.stringify(selected) + ".every(id=>tabs.find(tab=>tab.id===id)?.groupId===-1) && document.querySelectorAll('.ungrouped-section .tab-row.selected').length===2;");
  const ungrouped = (await batchCommands()).filter((message) => message.type === 'tabs:ungroup');
  assert.equal(ungrouped.length, 1);
  assert.deepEqual(ungrouped[0].tabIds, selected);
  // Save failure rolls the whole batch back, preserving the selection.
  await run("window.__batchWriteFailed=false;if(extension){const original=chrome.storage.local.set;chrome.storage.local.set=async function(values,...rest){if(!window.__batchWriteFailed&&values.spaceTabsState){window.__batchWriteFailed=true;throw Error('Batch checkpoint failure');}return original.call(this,values,...rest);};window.__restoreBatchWrite=()=>{chrome.storage.local.set=original;};}else{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===localStorage&&key==='spaceTabsState'&&!window.__batchWriteFailed){window.__batchWriteFailed=true;throw Error('Batch checkpoint failure');}return original.call(this,key,value);};window.__restoreBatchWrite=()=>{Storage.prototype.setItem=original;};}");
  await drop(targetHeader);
  await check("const tabs=await runtimeTabs();return window.__batchWriteFailed && !document.querySelector('#tidyNamesButton').disabled && " + JSON.stringify(selected) + ".every(id=>tabs.find(tab=>tab.id===id)?.groupId===-1) && document.querySelectorAll('.ungrouped-section .tab-row.selected').length===2;");
  await run("window.__restoreBatchWrite();");
  // A saved-only target retains its existing saved row alongside the batch.
  const savedKey = await run("return [...document.querySelectorAll('.group-card')].find(card=>card.querySelector('h2')?.textContent==='Batch Saved')?.dataset.groupKey;");
  assert.ok(savedKey);
  await drop('.group-card[data-group-key=' + JSON.stringify(savedKey) + '] > .group-header');
  await check("const tabs=await runtimeTabs();const first=tabs.find(tab=>tab.id===" + selected[0] + "); const state=await read();return first?.groupId>=0 && tabs.find(tab=>tab.id===" + selected[1] + ")?.groupId===first.groupId && Object.values(state.spaceSnapshots||{}).some(snapshot=>snapshot.groups?.some(group=>group.tabs?.some(tab=>tab.snapshotTabId==='batch-saved-row')));");
  assert.notEqual(emptyGroupId.id, null);
  return ['Shift selection moves in one grouping call', 'same-group block ordering', 'empty Tag batch', 'Ungrouped batch', 'whole-batch rollback', 'saved identities and panel names preserved', 'saved destination keeps saved rows'];
}
