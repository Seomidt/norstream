import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import type { Programme } from '@norstream/core';

const m = vi.hoisted(() => ({short:vi.fn(), full:vi.fn(), list:vi.fn(), xml:vi.fn(), write:vi.fn(), listeners:new Set<(s:string)=>void>(), start:0, app:{currentState:'active'}}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {Platform:{isTV:true,OS:'android'},AppState:{get currentState(){return m.app.currentState;},addEventListener:(_n:string,f:(s:string)=>void)=>{m.listeners.add(f);return{remove:()=>m.listeners.delete(f)};}},View:'View',Text:'Text',TVFocusGuideView:'TVFocusGuideView',StyleSheet:{create:(v:unknown)=>v,hairlineWidth:0.5},useTVEventHandler:()=>{},
    FlatList:React.forwardRef(function List(p:any,ref){React.useImperativeHandle(ref,()=>({scrollToIndex:vi.fn()}));return React.createElement('NativeList',p,p.data.slice(m.start,m.start+12).map((item:StoredChannel,i:number)=>React.createElement(React.Fragment,{key:item.id},p.renderItem({item,index:i+m.start}))));})};
});
vi.mock('../../sync/epgCache.js',()=>({ensureEpg:m.short,ensureFullEpg:m.full}));
vi.mock('../../storage/programmes.js',()=>({listProgrammes:m.list,upsertProgrammes:m.write}));
vi.mock('../../sync/panelEpg.js',()=>({syncPanelEpg:m.xml}));
vi.mock('../../ui/ChannelLogo.js',()=>({ChannelLogo:()=>null}));
vi.mock('../../ui/TvPressable.js',()=>({TvPressable:'TvPressable'}));
vi.mock('../../ui/ThemeContext.js',()=>({useStyles:(make:(c:any)=>unknown)=>make({text:'#fff',textMuted:'#ccc',surface:'#111',background:'#000',accent:'#0af',danger:'#f00'})}));
import { TimelineGrid } from './TimelineGrid.js';
let tree:ReactTestRenderer|null=null;
type Props=Parameters<typeof TimelineGrid>[0];let options:Props;
const channels=Array.from({length:100},(_,i)=>({id:`panel:${i}`,sourceId:'panel',streamId:String(i),streamUrl:null,name:`Kanal ${i}`,logoUrls:[],hasArchive:true} as unknown as StoredChannel));
const programme=(id:string,title='Friskt program',start='2026-10-26T09:00:00Z',stop='2026-10-26T10:00:00Z'):Programme=>({channelId:id,title,description:null,start:new Date(start),stop:new Date(stop)});
const ok={fetched:1,failed:0,programmes:1,reason:null};
function props(extra:Partial<Props>={}):Props {const session={db:{},credsBySource:new Map([['panel',{}]]),fetchImpl:vi.fn(),access:()=>({source:{kind:'xtream'}})} as unknown as AppSession;return{session,channels,now:new Date('2026-10-26T09:15:00Z'),hasDialectFor:()=>true,onFocusChannel:vi.fn(),onFocusProgramme:vi.fn(),onOpen:vi.fn(),offsetMinutes:0,onStepTime:vi.fn(),focusFirstSignal:0,active:true,returnFocusChannelId:null,onReturnFocus:vi.fn(),...extra};}
async function mount(p=props()){options=p;await act(async()=>{tree=create(createElement(TimelineGrid,p),{createNodeMock:()=>({requestTVFocus:vi.fn()})});});await act(async()=>tree!.root.findByType('TVFocusGuideView' as any).props.onLayout({nativeEvent:{layout:{height:400}}}));}
async function update(p:Partial<Props>){options={...options,...p};await act(async()=>tree!.update(createElement(TimelineGrid,options)));}
const text=()=>tree!.root.findAllByType('Text' as any).map(n=>n.children.join('')).join(' | ');
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
async function foreground(s:string){await act(async()=>{m.app.currentState=s;for(const f of m.listeners)f(s);});}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('requestAnimationFrame',(f:()=>void)=>setTimeout(f,1));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
  m.app.currentState='active';m.start=0;m.listeners.clear();
  m.short.mockReset().mockImplementation(async(_db,_creds,_fetch,ids,_now,_limit,opts)=>{opts.onProgrammes(ids[0],[programme(ids[0])]);return ok;});
  m.full.mockReset().mockImplementation(async(_db,_creds,_fetch,items,_now,opts)=>{opts.onProgrammes(items[0].id,[programme(items[0].id,'Arkiv')]);return ok;});
  m.xml.mockReset().mockImplementation(async(_db,_source,_creds,opts)=>({matched:opts.channelIds.length,programmes:opts.channelIds.length,channelIds:opts.channelIds}));
  m.write.mockReset().mockResolvedValue(undefined);m.list.mockReset().mockImplementation(async(_db,id:string)=>[programme(id,'Importeret XML')]);
});
afterEach(async()=>{if(tree)await act(async()=>{tree!.unmount();tree=null;});expect(m.listeners.size).toBe(0);vi.unstubAllGlobals();});

it('aabner med en lille frisk forespoergsel og ingen arkiv-/SQL-laesning',async()=>{
  await mount(props({channels:channels.slice(0,2)}));expect(m.short).toHaveBeenCalledTimes(2);expect(m.full).not.toHaveBeenCalled();expect(m.list).not.toHaveBeenCalled();
  for(const call of m.short.mock.calls){expect(call[5]).toBe(12);expect(call[6].force).toBe(true);}
  expect(text()).toContain('Friskt program');
});
it('viser foerste kanal uden at vente paa den naeste',async()=>{
  const wait=deferred<any>();m.short.mockImplementationOnce(async(...args:any[])=>{args[6].onProgrammes(args[3][0],[programme(args[3][0],'Klar straks')]);return ok;}).mockReturnValueOnce(wait.promise);
  await mount(props({channels:channels.slice(0,2)}));expect(text()).toContain('Klar straks');expect(text()).toContain('Henter programoversigt');
  await act(async()=>wait.resolve(ok));
});
it('tegner ikke blandede SQL-data efter en frisk forespoergsel eller tidsflytning',async()=>{
  m.list.mockImplementation(async(_db,id:string)=>[programme(id,'Forkert en time senere','2026-10-26T10:00:00Z','2026-10-26T11:00:00Z')]);
  await mount(props({channels:channels.slice(0,1)}));await update({now:new Date('2026-10-26T09:31:00Z')});
  expect(m.list).not.toHaveBeenCalled();expect(text()).toContain('Friskt program');expect(text()).not.toContain('Forkert en time senere');
});
it('15:15-16:15 er én bjælke med samme originaltid i detaljefelt og OK',async()=>{
  const p=programme(channels[0]!.id,'Jordemoderen XV (6:8)','2026-10-26T15:15:00Z','2026-10-26T16:15:00Z');
  m.short.mockImplementation(async(...args:any[])=>{args[6].onProgrammes(args[3][0],[p]);return ok;});
  const onOpen=vi.fn(),onFocusProgramme=vi.fn();await mount(props({channels:channels.slice(0,1),now:new Date('2026-10-26T15:23:00Z'),onOpen,onFocusProgramme}));
  await act(async()=>tree!.root.findByType('TvPressable' as any).props.onFocus());
  expect(text().match(/Jordemoderen/g)).toHaveLength(1);expect(onFocusProgramme).toHaveBeenLastCalledWith(p);
  tree!.root.findByType('TvPressable' as any).props.onPress();expect(onOpen).toHaveBeenLastCalledWith(channels[0],p,'live');
  const slots=tree!.root.findAll(n=>n.type==='View' as any && typeof n.props.style?.width==='string');
  expect(slots).toHaveLength(3);[100/6,100*2/3,100/6].forEach((width,i)=>expect(parseFloat(slots[i]!.props.style.width)).toBeCloseTo(width));
  expect(slots.every(n=>n.props.style.paddingHorizontal===undefined && n.props.style.marginRight===undefined)).toBe(true);
});
it('henter hele tabellen foerst ved tidsbladning, én gang pr. kanal og besoeg',async()=>{
  await mount(props({channels:channels.slice(0,1)}));await update({offsetMinutes:-30});expect(m.full).toHaveBeenCalledTimes(1);expect(m.full.mock.calls[0]![5].force).toBe(true);
  await update({offsetMinutes:-60});await update({offsetMinutes:0});await update({offsetMinutes:60});expect(m.full).toHaveBeenCalledTimes(1);expect(m.short).toHaveBeenCalledTimes(1);expect(m.list).not.toHaveBeenCalled();
});
it('aabner direkte historisk med fuld tabel, uden foerst at hente kort EPG',async()=>{
  await mount(props({channels:channels.slice(0,1),offsetMinutes:-120}));expect(m.full).toHaveBeenCalledTimes(1);expect(m.short).not.toHaveBeenCalled();
});
it('viser intet gammelt kort under ny indgang',async()=>{
  const session=props().session;await mount(props({session,channels:channels.slice(0,1)}));await act(async()=>{tree!.unmount();tree=null;});
  const wait=deferred<any>();m.short.mockReturnValueOnce(wait.promise);await mount(props({session,channels:channels.slice(0,1)}));expect(text()).toContain('Henter programoversigt');expect(text()).not.toContain('Friskt program');await act(async()=>wait.resolve(ok));
});
it('henter kun synlige kanaler og stopper endnu ikke startede skjulte kald',async()=>{
  const wait=deferred<any>();m.short.mockReturnValueOnce(wait.promise);await mount();const mayContinue=m.short.mock.calls[0]![6].shouldContinue;
  await act(async()=>{m.start=50;tree!.root.findByType('NativeList' as any).props.onViewableItemsChanged({viewableItems:[{index:50}]});});expect(mayContinue()).toBe(false);
  await act(async()=>wait.resolve({fetched:0,failed:0,programmes:0}));expect(m.short).toHaveBeenCalledTimes(13);expect(m.short.mock.calls.slice(1).map(c=>c[3][0])).toEqual(channels.slice(50,62).map(c=>c.id));
});
it('ignorerer sent HTTP-svar fra forrige session',async()=>{
  const wait=deferred<any>();let capture:any;m.short.mockImplementationOnce(async(...args:any[])=>{capture=args[6];await wait.promise;capture.onProgrammes(args[3][0],[programme(args[3][0],'Gammel session')]);return ok;});
  await mount(props({channels:channels.slice(0,1)}));await update({session:props().session});expect(capture.shouldContinue()).toBe(false);await act(async()=>wait.resolve(ok));expect(text()).not.toContain('Gammel session');expect(text()).toContain('Friskt program');
});
it('henter igen ved appens tilbagekomst',async()=>{await mount(props({channels:channels.slice(0,1)}));await foreground('background');await foreground('active');expect(m.short).toHaveBeenCalledTimes(2);});
it('viser sikker fejl uden adresser',async()=>{m.short.mockResolvedValue({fetched:0,failed:1,programmes:0,reason:'private-url'});await mount(props({channels:channels.slice(0,1)}));expect(text()).toContain('Programoversigten kunne ikke hentes.');expect(text()).not.toContain('private-url');});
it('bevarer M3U-import uden panelkald',async()=>{const session=props().session;session.access=()=>({source:{kind:'m3u'}} as any);await mount(props({session,channels:[{...channels[0]!,streamUrl:'https://example.invalid/live'}]}));expect(m.short).not.toHaveBeenCalled();expect(m.full).not.toHaveBeenCalled();expect(text()).toContain('Importeret XML');});
it('bevarer frisk XMLTV-fallback og fastlaaser resultatet til besoeg',async()=>{
  m.short.mockResolvedValue({fetched:1,failed:0,programmes:0});await mount(props({channels:channels.slice(0,2)}));expect(m.xml).toHaveBeenCalledTimes(1);expect(m.short).toHaveBeenCalledTimes(2);expect(text()).toContain('Importeret XML');
  const calls=m.list.mock.calls.length;m.list.mockResolvedValue([]);await update({offsetMinutes:30});expect(m.list).toHaveBeenCalledTimes(calls);expect(m.full).not.toHaveBeenCalled();expect(text()).toContain('Importeret XML');
});
it('XML uden match forhindrer ikke naeste kanals API',async()=>{
  m.short.mockResolvedValueOnce({fetched:1,failed:0,programmes:0});m.xml.mockResolvedValue({matched:0,programmes:0,channelIds:[]});await mount(props({channels:channels.slice(0,2)}));expect(m.short).toHaveBeenCalledTimes(2);expect(text()).toContain('Friskt program');
});

it('en langsom XML-fil paa foerste kanal blokerer ikke naeste kanals API',async()=>{
  const wait=deferred<any>();m.short.mockResolvedValueOnce({fetched:1,failed:0,programmes:0});m.xml.mockReturnValueOnce(wait.promise);
  await mount(props({channels:channels.slice(0,2)}));expect(m.short).toHaveBeenCalledTimes(2);expect(text()).toContain('Friskt program');expect(text()).toContain('Henter programoversigt');
  expect(m.xml.mock.calls[0]![3].channelIds).not.toContain(channels[1]!.id);
  await act(async()=>wait.resolve({matched:0,programmes:0,channelIds:[]}));expect(text()).toContain('Friskt program');
});

it('bladrer i korte svarets tidsrum straks uden fuld arkivforespoergsel',async()=>{
  m.short.mockImplementation(async(...args:any[])=>{args[6].onProgrammes(args[3][0],[programme(args[3][0],'Lang frisk oversigt','2026-10-26T09:00:00Z','2026-10-26T16:00:00Z')]);return ok;});
  await mount(props({channels:channels.slice(0,1)}));await update({offsetMinutes:30});await update({offsetMinutes:60});
  expect(m.full).not.toHaveBeenCalled();expect(m.short).toHaveBeenCalledTimes(1);expect(text()).toContain('Lang frisk oversigt');
});
