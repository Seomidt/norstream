import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import type { Programme } from '@norstream/core';

const f = vi.hoisted(() => ({
  tv: false, list: vi.fn(), channels: vi.fn(), full: vi.fn(), short: vi.fn(), file: vi.fn(), clear: vi.fn(),
  appListeners: new Set<(state: string) => void>(),
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform:{isTV:false,OS:'android'},ActivityIndicator:'ActivityIndicator',View:'View',Text:'Text',ScrollView:'ScrollView',TVFocusGuideView:'TVFocusGuideView',
    StyleSheet:{create:(v: unknown)=>v,hairlineWidth:0.5},PanResponder:{create:()=>({panHandlers:{}})},
    useTVEventHandler:()=>{},
    AppState:{currentState:'active',addEventListener:(_event: string,fn:(s:string)=>void)=>{f.appListeners.add(fn);return {remove:()=>f.appListeners.delete(fn)};}},
    FlatList:React.forwardRef(function TestList(props: any,ref) {
      React.useImperativeHandle(ref,()=>({scrollToIndex:()=>{},scrollToOffset:()=>{}}));
      return React.createElement('NativeList',props,props.data.map((item: any,index: number)=>
        React.createElement(React.Fragment,{key:props.keyExtractor(item)},props.renderItem({item,index}))));
    }),
  };
});
vi.mock('../../ui/tv.js',()=>({get isTV(){return f.tv;},useCanvasSize:()=>({width:864,height:486})}));
vi.mock('../../ui/ThemeContext.js',()=>({useStyles:(make:any)=>make({}),useTheme:()=>({colors:{}})}));
vi.mock('../../ui/TvPressable.js',()=>({TvPressable:'TvPressable'}));
vi.mock('../../ui/ChannelLogo.js',()=>({ChannelLogo:()=>null}));
vi.mock('../../ui/Notice.js',()=>({Notice:'Notice'}));
vi.mock('../../storage/programmes.js',()=>({listProgrammes:f.list,upsertProgrammes:f.clear}));
vi.mock('../../sync/panelEpg.js',()=>({syncPanelEpg:f.file}));
vi.mock('../../storage/channels.js',()=>({listChannels:f.channels}));
vi.mock('../../storage/settings.js',()=>({getFavoriteGroup:async()=>null,getGuideInfoMode:async()=>'normal',setFavoriteGroup:async()=>{},sourcesWithDialect:async()=>new Set(['source'])}));
vi.mock('../../storage/favoriteGroups.js',()=>({listFavoriteGroups:async()=>[]}));
vi.mock('../../storage/reminders.js',()=>({hasReminder:async()=>false,addReminder:async()=>{},removeReminder:async()=>{}}));
vi.mock('../../sync/epgCache.js',()=>({ensureFullEpg:f.full,ensureEpg:f.short}));
vi.mock('../../sync/weather.js',()=>({loadCachedWeather:async()=>null,refreshWeather:async()=>null}));
vi.mock('../../sync/news.js',()=>({loadCachedNews:async()=>null,refreshNews:async()=>null}));
vi.mock('../../diagnostics/log.js',()=>({logEvent:()=>{}}));
vi.mock('../preview/MiniPreview.js',()=>({MiniPreview:()=>null}));
vi.mock('./ClockWeather.js',()=>({ClockWeather:()=>null}));
vi.mock('./NewsTicker.js',()=>({NewsTicker:()=>null}));
vi.mock('./TimelineGrid.js',()=>({TimelineGrid:'TimelineGrid'}));
vi.mock('./ChannelDayScreen.js',()=>({ChannelDayScreen:'ChannelDayScreen'}));
vi.mock('./ProgrammeSheet.js',()=>({ProgrammeSheet:()=>null}));
vi.mock('./NowNextBox.js',()=>({NowNextBox:'NowNextBox'}));

import { GuideScreen } from './GuideScreen.js';
const channel={id:'source:1',sourceId:'source',name:'DR2',logoUrls:[],hasArchive:true,archiveDays:7} as unknown as StoredChannel;
const session={db:{},credsBySource:new Map([['source',{}]]),fetchImpl:vi.fn()} as unknown as AppSession;
const programme=(title='Frisk udsendelse'):Programme=>({channelId:channel.id,title,description:null,start:new Date(Date.now()-300_000),stop:new Date(Date.now()+300_000)});
const props=(extra:Record<string,unknown>={})=>({session,onPlay:vi.fn(),onRestart:vi.fn(),onAuthError:vi.fn(),onBrowse:vi.fn(),previewEnabled:false,previewHandle:{current:null},...extra});
let tree:ReactTestRenderer|null=null;
const mount=async(options=props())=>act(async()=>{tree=create(createElement(GuideScreen,options));});
const advance=async()=>act(async()=>{await vi.advanceTimersByTimeAsync(350);});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};};
const text=(value:any):string=>value==null?'':typeof value==='string'?value:Array.isArray(value)?value.map(text).join(''):text(value.children??value.props?.children);
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T07:15:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>setTimeout(fn,16));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
  f.tv=false;f.channels.mockReset().mockResolvedValue([channel]);f.list.mockReset().mockImplementation(async()=>[programme()]);
  f.full.mockReset().mockResolvedValue({failed:0,fetched:1,programmes:1});f.short.mockReset();f.file.mockReset().mockResolvedValue(null);f.clear.mockReset().mockResolvedValue(undefined);f.appListeners.clear();
});
afterEach(async()=>{if(tree!==null)await act(async()=>{tree!.unmount();tree=null;});expect(f.appListeners.size).toBe(0);vi.unstubAllGlobals();vi.useRealTimers();});

it('TV-foraelderen starter ingen skjulte EPG-hentninger eller gammel preview-laesning',async()=>{
  f.tv=true;
  await mount();await advance();
  expect(f.full).not.toHaveBeenCalled();expect(f.short).not.toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();
  expect(tree!.root.findByType('NowNextBox' as any).props.programmes).toEqual([]);
  const fresh=programme();
  await act(async()=>tree!.root.findByType('TimelineGrid' as any).props.onFocusProgramme(fresh));
  expect(tree!.root.findByType('NowNextBox' as any).props.focus).toBe(fresh);
  await act(async()=>tree!.update(createElement(GuideScreen,props({active:false}))));
  expect(tree!.root.findByType('NowNextBox' as any).props.focus).toBeNull();
});

it('telefonen viser det gemte straks og fornyer i baggrunden uden at tvinge (v423)',async()=>{
  const pending=deferred<any>();f.full.mockReturnValue(pending.promise);
  await mount();await advance();
  expect(f.list).toHaveBeenCalled();expect(text(tree!.toJSON())).toContain('Frisk udsendelse');
  expect(f.full).toHaveBeenCalledTimes(1);expect(f.short).not.toHaveBeenCalled();
  expect(f.full.mock.calls[0]![5].force).toBeUndefined();
  await act(async()=>pending.resolve({failed:0,fetched:1,programmes:1}));
  expect(text(tree!.toJSON())).toContain('Frisk udsendelse');
});

it('telefonen genaabner med det sidst viste, ogsaa mens SQL stadig laeser',async()=>{
  const options=props();await mount(options);await advance();
  await act(async()=>{tree!.unmount();tree=null;});
  const slow=deferred<Programme[]>();f.list.mockReturnValue(slow.promise);
  await mount(options);
  expect(text(tree!.toJSON())).toContain('Frisk udsendelse');
  await act(async()=>slow.resolve([programme()]));await advance();
});

it('telefonens gentagne synligheds-events genhenter ikke samme kanal i indgangen',async()=>{
  await mount();await advance();
  const list=tree!.root.findByType('NativeList' as any);
  await act(async()=>{list.props.onViewableItemsChanged({viewableItems:[{item:channel}]});list.props.onViewableItemsChanged({viewableItems:[{item:channel}]});});
  await advance();
  expect(f.full).toHaveBeenCalledTimes(1);expect(f.short).not.toHaveBeenCalled();
});

it('skjult telefon-guide stopper koearbejde og genhenter ved ny indgang',async()=>{
  const pending=deferred<any>();f.full.mockReturnValueOnce(pending.promise);
  const options=props();await mount(options);await advance();
  const shouldContinue=f.full.mock.calls[0]![5].shouldContinue;
  await act(async()=>tree!.update(createElement(GuideScreen,{...options,active:false})));
  expect(shouldContinue()).toBe(false);
  const reads=f.list.mock.calls.length;
  await act(async()=>pending.resolve({failed:0,fetched:1,programmes:1}));
  expect(f.list).toHaveBeenCalledTimes(reads);
  await act(async()=>tree!.update(createElement(GuideScreen,{...options,active:true})));await advance();
  expect(f.full).toHaveBeenCalledTimes(2);expect(text(tree!.toJSON())).toContain('Frisk udsendelse');
});

it('et sent SQL-svar fra forrige telefonindgang kan ikke genoplive gamle programmer',async()=>{
  const pending=deferred<Programme[]>();f.list.mockReturnValueOnce(pending.promise);
  const options=props();await mount(options);await advance();
  await act(async()=>tree!.update(createElement(GuideScreen,{...options,active:false})));
  await act(async()=>tree!.update(createElement(GuideScreen,{...options,active:true})));await advance();
  await act(async()=>pending.resolve([programme('Gammel SQL')]));
  await advance();
  expect(text(tree!.toJSON())).not.toContain('Gammel SQL');
  expect(text(tree!.toJSON())).toContain('Frisk udsendelse');expect(f.full).toHaveBeenCalledTimes(2);
});

it('telefonen genhenter efter baggrund og begrænser foerste hentning til synlige raekker',async()=>{
  f.channels.mockResolvedValue(Array.from({length:30},(_,i)=>({...channel,id:`source:${i+1}`})));
  await mount();await advance();expect(f.full).toHaveBeenCalledTimes(12);
  await act(async()=>{for(const fn of f.appListeners)fn('background');});
  await act(async()=>{for(const fn of f.appListeners)fn('active');});await advance();
  expect(f.full).toHaveBeenCalledTimes(24);
});


it('UK/US uden API-oversigt faar panelets XMLTV-fil én gang pr. kilde, uden at tvinge',async()=>{
  const uk={...channel,id:'source:uk',name:'UK Channel'}, us={...channel,id:'source:us',name:'US Channel'};
  f.channels.mockResolvedValue([uk,us]);
  const records=new Map<string,Programme[]>([
    [uk.id,[{...programme('Gammel UK'),channelId:uk.id}]],
    [us.id,[{...programme('Gammel US'),channelId:us.id}]],
  ]);
  f.list.mockImplementation(async(_db,id)=>records.get(id)??[]);
  f.full.mockResolvedValue({failed:0,fetched:1,programmes:0});
  f.file.mockImplementation(async(_db,_source,_creds,options)=>{
    for(const id of options.channelIds)records.set(id,[{...programme(`Frisk ${id}`),channelId:id}]);
    return {matched:2,programmes:2,channelIds:[uk.id,us.id]};
  });
  await mount();await advance();
  // Begge kanalers API spoerges; filen hentes bagefter, én gang for begge.
  expect(f.full).toHaveBeenCalledTimes(2);
  expect(f.file).toHaveBeenCalledTimes(1);
  expect(f.file.mock.calls[0]![3]).toMatchObject({channelIds:[uk.id,us.id]});
  expect(f.file.mock.calls[0]![3].force).toBeUndefined();expect(f.file.mock.calls[0]![3].fresh).toBeUndefined();
  expect(f.clear).not.toHaveBeenCalled();
  expect(text(tree!.toJSON())).toContain('Frisk source:uk');
  expect(text(tree!.toJSON())).toContain('Frisk source:us');
  expect(text(tree!.toJSON())).not.toContain('Gammel');
  const list=tree!.root.findByType('NativeList' as any);
  await act(async()=>list.props.onViewableItemsChanged({viewableItems:[{item:uk},{item:us}]}));await advance();
  expect(f.file).toHaveBeenCalledTimes(1);expect(f.full).toHaveBeenCalledTimes(2);
});


it('en XMLTV-fil uden match blokerer ikke naeste kanals fungerende API',async()=>{
  const uk={...channel,id:'source:uk',name:'UK uden filmatch'},us={...channel,id:'source:us',name:'US med API'};
  f.channels.mockResolvedValue([uk,us]);
  const records=new Map<string,Programme[]>([
    [uk.id,[{...programme('Gammel UK'),channelId:uk.id}]],
    [us.id,[{...programme('Gammel US'),channelId:us.id}]],
  ]);
  f.list.mockImplementation(async(_db,id)=>records.get(id)??[]);
  f.full.mockImplementation(async(_db,_creds,_fetch,selected)=>{
    if(selected[0].id===uk.id)return {failed:0,fetched:1,programmes:0};
    records.set(us.id,[{...programme('Frisk US API'),channelId:us.id}]);
    return {failed:0,fetched:1,programmes:1};
  });
  f.file.mockResolvedValue({matched:0,programmes:0,channelIds:[]});
  await mount();await advance();
  expect(f.full).toHaveBeenCalledTimes(2);expect(f.file).toHaveBeenCalledTimes(1);
  expect(text(tree!.toJSON())).toContain('Frisk US API');
  // Den gemte UK-oversigt bliver staaende, naar filen intet nyt havde.
  expect(text(tree!.toJSON())).toContain('Gammel UK');
  expect(text(tree!.toJSON())).not.toContain('Gammel US');
});
