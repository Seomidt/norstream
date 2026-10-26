import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import type { Programme } from '@norstream/core';

const m = vi.hoisted(() => ({short:vi.fn(), full:vi.fn(), list:vi.fn(), xml:vi.fn(), write:vi.fn(), listeners:new Set<(s:string)=>void>(), start:0, app:{currentState:'active'}, store:new Map<string, any[]>()}));
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
  m.app.currentState='active';m.start=0;m.listeners.clear();m.store.clear();
  // SQL i hukommelsen: hentningerne skriver, guiden laeser.
  m.list.mockReset().mockImplementation(async(_db,id:string,from:Date,to:Date)=>(m.store.get(id)??[]).filter((p:Programme)=>p.stop>from&&p.start<to));
  m.short.mockReset().mockImplementation(async(_db,_creds,_fetch,ids)=>{m.store.set(ids[0],[programme(ids[0])]);return ok;});
  m.full.mockReset().mockImplementation(async(_db,_creds,_fetch,items)=>{m.store.set(items[0].id,[programme(items[0].id,'Arkiv')]);return ok;});
  m.xml.mockReset().mockImplementation(async(_db,_source,_creds,opts)=>{for(const id of opts.channelIds)m.store.set(id,[programme(id,'Importeret XML')]);return{matched:opts.channelIds.length,programmes:opts.channelIds.length,channelIds:opts.channelIds};});
  m.write.mockReset().mockResolvedValue(undefined);
});
afterEach(async()=>{if(tree)await act(async()=>{tree!.unmount();tree=null;});expect(m.listeners.size).toBe(0);vi.unstubAllGlobals();});

it('viser det gemte straks uden at vente paa panelet (v423)',async()=>{
  m.store.set(channels[0]!.id,[programme(channels[0]!.id,'Gemt program')]);
  const wait=deferred<any>();m.short.mockReturnValue(wait.promise);
  await mount(props({channels:channels.slice(0,1)}));
  expect(text()).toContain('Gemt program');expect(text()).not.toContain('Henter programoversigt');
  await act(async()=>wait.resolve({fetched:0,failed:0,programmes:0,reason:null}));
});
it('fornyer i baggrunden efter hentereglerne, uden at tvinge',async()=>{
  await mount(props({channels:channels.slice(0,2)}));
  expect(m.short).toHaveBeenCalledTimes(2);expect(m.full).toHaveBeenCalledTimes(2);
  for(const call of m.short.mock.calls){expect(call[5]).toBe(12);expect(call[6].force).toBeUndefined();}
  for(const call of m.full.mock.calls)expect(call[5].force).toBeUndefined();
  expect(text()).toContain('Arkiv');
});
it('nu/naeste for alle synlige foer hele tabellerne',async()=>{
  const order:string[]=[];m.short.mockImplementation(async(_d,_c,_f,ids)=>{order.push(`kort ${ids[0]}`);return ok;});m.full.mockImplementation(async(_d,_c,_f,items)=>{order.push(`fuld ${items[0].id}`);return ok;});
  await mount(props({channels:channels.slice(0,2)}));
  expect(order).toEqual(['kort panel:0','kort panel:1','fuld panel:0','fuld panel:1']);
});
it('viser "Henter" kun for en kanal uden gemte programmer',async()=>{
  m.store.set(channels[0]!.id,[programme(channels[0]!.id,'Klar straks')]);
  const wait=deferred<any>();m.short.mockReturnValue(wait.promise);
  await mount(props({channels:channels.slice(0,2)}));expect(text()).toContain('Klar straks');expect(text()).toContain('Henter programoversigt');
  await act(async()=>wait.resolve({fetched:0,failed:0,programmes:0,reason:null}));
});
it('en ny aabning viser det sidst viste med det samme',async()=>{
  const session=props().session;await mount(props({session,channels:channels.slice(0,1)}));expect(text()).toContain('Arkiv');
  await act(async()=>{tree!.unmount();tree=null;});
  const slow=deferred<any>();m.list.mockReturnValue(slow.promise);m.short.mockReturnValue(deferred<any>().promise);
  await mount(props({session,channels:channels.slice(0,1)}));expect(text()).toContain('Arkiv');expect(text()).not.toContain('Henter programoversigt');
  await act(async()=>slow.resolve([]));
});
it('15:15-16:15 er én bjælke med samme originaltid i detaljefelt og OK',async()=>{
  const p=programme(channels[0]!.id,'Jordemoderen XV (6:8)','2026-10-26T15:15:00Z','2026-10-26T16:15:00Z');
  m.store.set(channels[0]!.id,[p]);m.short.mockResolvedValue({fetched:0,failed:0,programmes:0,reason:null});m.full.mockResolvedValue({fetched:0,failed:0,programmes:0,reason:null});
  const onOpen=vi.fn(),onFocusProgramme=vi.fn();await mount(props({channels:channels.slice(0,1),now:new Date('2026-10-26T15:23:00Z'),onOpen,onFocusProgramme}));
  await act(async()=>tree!.root.findByType('TvPressable' as any).props.onFocus());
  expect(text().match(/Jordemoderen/g)).toHaveLength(1);expect(onFocusProgramme).toHaveBeenLastCalledWith(p);
  tree!.root.findByType('TvPressable' as any).props.onPress();expect(onOpen).toHaveBeenLastCalledWith(channels[0],p,'live');
  const slots=tree!.root.findAll(n=>n.type==='View' as any && typeof n.props.style?.width==='string');
  expect(slots).toHaveLength(3);[100/6,100*2/3,100/6].forEach((width,i)=>expect(parseFloat(slots[i]!.props.style.width)).toBeCloseTo(width));
  expect(slots.every(n=>n.props.style.paddingHorizontal===undefined && n.props.style.marginRight===undefined)).toBe(true);
});
it('bladring i tiden laeser SQL og spoerger ikke panelet igen',async()=>{
  await mount(props({channels:channels.slice(0,1)}));await update({offsetMinutes:-30});await update({offsetMinutes:-120});await update({offsetMinutes:60});
  expect(m.short).toHaveBeenCalledTimes(1);expect(m.full).toHaveBeenCalledTimes(1);expect(m.list.mock.calls.length).toBeGreaterThan(1);
});
it('en halv time senere spoerges hentereglerne igen',async()=>{
  await mount(props({channels:channels.slice(0,1)}));await update({now:new Date('2026-10-26T09:31:00Z')});
  expect(m.short).toHaveBeenCalledTimes(2);expect(m.full).toHaveBeenCalledTimes(2);
});
it('henter kun synlige kanaler og stopper endnu ikke startede skjulte kald',async()=>{
  const wait=deferred<any>();m.short.mockReturnValueOnce(wait.promise);await mount();const mayContinue=m.short.mock.calls[0]![6].shouldContinue;
  await act(async()=>{m.start=50;tree!.root.findByType('NativeList' as any).props.onViewableItemsChanged({viewableItems:[{index:50}]});});expect(mayContinue()).toBe(false);
  await act(async()=>wait.resolve({fetched:0,failed:0,programmes:0}));expect(m.short).toHaveBeenCalledTimes(13);expect(m.short.mock.calls.slice(1).map(c=>c[3][0])).toEqual(channels.slice(50,62).map(c=>c.id));
  expect(m.full.mock.calls.map(c=>c[3][0].id)).toEqual(channels.slice(50,62).map(c=>c.id));
});
it('et forladt besoeg stopper sine endnu ikke startede kald',async()=>{
  const wait=deferred<any>();let capture:any;m.short.mockImplementationOnce(async(...args:any[])=>{capture=args[6];return wait.promise;});
  await mount(props({channels:channels.slice(0,1)}));await update({session:props().session});expect(capture.shouldContinue()).toBe(false);await act(async()=>wait.resolve(ok));
});
it('spoerger igen ved appens tilbagekomst',async()=>{await mount(props({channels:channels.slice(0,1)}));await foreground('background');await foreground('active');expect(m.short).toHaveBeenCalledTimes(2);});
it('viser sikker fejl uden adresser naar intet er gemt',async()=>{
  m.short.mockResolvedValue({fetched:0,failed:1,programmes:0,reason:'private-url'});m.full.mockResolvedValue({fetched:0,failed:1,programmes:0,reason:'private-url'});
  await mount(props({channels:channels.slice(0,1)}));expect(text()).toContain('Programoversigten kunne ikke hentes.');expect(text()).not.toContain('private-url');
});
it('en panelfejl skjuler ikke det gemte',async()=>{
  m.store.set(channels[0]!.id,[programme(channels[0]!.id,'Gemt program')]);
  m.short.mockResolvedValue({fetched:0,failed:1,programmes:0,reason:'x'});m.full.mockResolvedValue({fetched:0,failed:1,programmes:0,reason:'x'});
  await mount(props({channels:channels.slice(0,1)}));expect(text()).toContain('Gemt program');expect(text()).not.toContain('kunne ikke hentes');
});
it('bevarer M3U-import uden panelkald',async()=>{const session=props().session;session.access=()=>({source:{kind:'m3u'}} as any);m.store.set(channels[0]!.id,[programme(channels[0]!.id,'Importeret XML')]);await mount(props({session,channels:[{...channels[0]!,streamUrl:'https://example.invalid/live'}]}));expect(m.short).not.toHaveBeenCalled();expect(m.full).not.toHaveBeenCalled();expect(text()).toContain('Importeret XML');});
it('kanaler uden API-oversigt faar panelets XMLTV-fil én gang pr. kilde, uden at tvinge',async()=>{
  m.short.mockResolvedValue({fetched:1,failed:0,programmes:0,reason:null});m.full.mockResolvedValue({fetched:1,failed:0,programmes:0,reason:null});
  await mount(props({channels:channels.slice(0,2)}));expect(m.xml).toHaveBeenCalledTimes(1);
  expect(m.xml.mock.calls[0]![3].channelIds).toEqual([channels[0]!.id,channels[1]!.id]);expect(m.xml.mock.calls[0]![3].force).toBeUndefined();expect(m.xml.mock.calls[0]![3].fresh).toBeUndefined();
  expect(text()).toContain('Importeret XML');
});
it('en langsom XML-fil blokerer ikke naeste kanals API',async()=>{
  const wait=deferred<any>();m.full.mockResolvedValueOnce({fetched:1,failed:0,programmes:0,reason:null});m.xml.mockReturnValueOnce(wait.promise);
  await mount(props({channels:channels.slice(0,2)}));expect(m.full).toHaveBeenCalledTimes(2);expect(text()).toContain('Arkiv');
  expect(m.xml.mock.calls[0]![3].channelIds).not.toContain(channels[1]!.id);
  await act(async()=>wait.resolve({matched:0,programmes:0,channelIds:[]}));
});
