import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { RoutePhase, useRouteTracker } from '../hooks/useRouteTracker';
import { getRoadRouteProblem } from '../services/directionsService';
import type { GoogleRouteMapProps } from './GoogleRouteMap';

/**
 * Web-only GoogleRouteMap (development preview).
 *
 * Metro picks this file instead of GoogleRouteMap.tsx when bundling for web,
 * so `react-native-maps` (no web support, crashes on import) is never loaded
 * in the browser. Android / iOS keep using GoogleRouteMap.tsx.
 *
 * Renders a Leaflet + OpenStreetMap map inside an <iframe> (no Google Maps key
 * needed for the map tiles). The LINES come from the same RouteTracker as the
 * native map — plant -> site before the start, truck -> site while in transit,
 * travelled history in gray after completion — so both show the same picture.
 * If the Routes API key is restricted to Android apps, the road route cannot
 * be fetched from a browser and a dashed amber direct line is shown instead.
 */

const TRUCK_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 128\"><defs><linearGradient id=\"b\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b6c2d1\"/><stop offset=\".2\" stop-color=\"#ffffff\"/><stop offset=\".8\" stop-color=\"#eef2f7\"/><stop offset=\"1\" stop-color=\"#8c9bb0\"/></linearGradient><linearGradient id=\"c\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#075985\"/><stop offset=\".28\" stop-color=\"#22a7ee\"/><stop offset=\".72\" stop-color=\"#0284c7\"/><stop offset=\"1\" stop-color=\"#0c4a6e\"/></linearGradient><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#0f172a\"/><stop offset=\"1\" stop-color=\"#475569\"/></linearGradient><filter id=\"s\" x=\"-40%\" y=\"-20%\" width=\"180%\" height=\"140%\"><feGaussianBlur stdDeviation=\"3.2\"/></filter></defs><rect x=\"15\" y=\"16\" width=\"42\" height=\"106\" rx=\"8\" fill=\"#0f172a\" opacity=\".38\" filter=\"url(#s)\"/><g fill=\"#111827\"><rect x=\"7\" y=\"24\" width=\"7\" height=\"14\" rx=\"2.5\"/><rect x=\"50\" y=\"24\" width=\"7\" height=\"14\" rx=\"2.5\"/><rect x=\"6\" y=\"80\" width=\"7\" height=\"15\" rx=\"2.5\"/><rect x=\"51\" y=\"80\" width=\"7\" height=\"15\" rx=\"2.5\"/><rect x=\"6\" y=\"99\" width=\"7\" height=\"15\" rx=\"2.5\"/><rect x=\"51\" y=\"99\" width=\"7\" height=\"15\" rx=\"2.5\"/></g><rect x=\"10.5\" y=\"43\" width=\"43\" height=\"78\" rx=\"4.5\" fill=\"url(#b)\" stroke=\"#5b6b80\" stroke-width=\"1.5\"/><g stroke=\"#c3ccd8\" stroke-width=\"1.2\"><line x1=\"13\" y1=\"57\" x2=\"51\" y2=\"57\"/><line x1=\"13\" y1=\"70\" x2=\"51\" y2=\"70\"/><line x1=\"13\" y1=\"83\" x2=\"51\" y2=\"83\"/><line x1=\"13\" y1=\"96\" x2=\"51\" y2=\"96\"/><line x1=\"13\" y1=\"109\" x2=\"51\" y2=\"109\"/></g><rect x=\"16\" y=\"47\" width=\"5\" height=\"70\" rx=\"2.5\" fill=\"#ffffff\" opacity=\".75\"/><rect x=\"24\" y=\"39\" width=\"16\" height=\"5\" fill=\"#334155\"/><path d=\"M14 40V21Q14 8 26 7H38Q50 8 50 21V40Z\" fill=\"url(#c)\" stroke=\"#0c4a6e\" stroke-width=\"1.5\"/><path d=\"M18 22Q18 13.5 26 13H38Q46 13.5 46 22V26H18Z\" fill=\"url(#g)\"/><path d=\"M21 22Q21 16.5 27 16H31L27 26H21Z\" fill=\"#ffffff\" opacity=\".28\"/><rect x=\"19\" y=\"28\" width=\"26\" height=\"10\" rx=\"3\" fill=\"#7dd3fc\" opacity=\".55\"/><rect x=\"8.5\" y=\"18\" width=\"5.5\" height=\"4.5\" rx=\"1.5\" fill=\"#0c4a6e\"/><rect x=\"50\" y=\"18\" width=\"5.5\" height=\"4.5\" rx=\"1.5\" fill=\"#0c4a6e\"/><rect x=\"18\" y=\"6.2\" width=\"7\" height=\"2.6\" rx=\"1.2\" fill=\"#fde68a\"/><rect x=\"39\" y=\"6.2\" width=\"7\" height=\"2.6\" rx=\"1.2\" fill=\"#fde68a\"/></svg>";

// Static page loaded once into the iframe. Data arrives via postMessage.
const MAP_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="referrer" content="origin"/>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<style>
  html,body,#map{height:100%;margin:0;padding:0;font-family:Arial,sans-serif}
  .dot{width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}
  .truck{width:28px;height:56px;transform-origin:50% 50%}
  .halo{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(100,116,139,.14);border:1px solid rgba(100,116,139,.3)}
  .halo.live{background:rgba(2,132,199,.16);border-color:rgba(2,132,199,.4)}
  #badge{position:absolute;left:10px;top:10px;z-index:1000;background:rgba(15,23,42,.88);color:#fff;font-size:10px;font-weight:800;letter-spacing:.3px;padding:5px 10px;border-radius:999px}
  #legend{position:absolute;left:10px;top:38px;z-index:1000;background:rgba(255,255,255,.94);border-radius:8px;padding:6px 8px;font-size:10px;font-weight:700;color:#231F20;box-shadow:0 1px 3px rgba(0,0,0,.2);line-height:15px}
  #legend i{display:inline-block;vertical-align:middle;margin-right:6px}
  #legend .d{width:9px;height:9px;border-radius:50%}
  #legend .l{width:14px;height:4px;border-radius:2px}
  #recenter{position:absolute;right:10px;bottom:24px;z-index:1000;width:34px;height:34px;border-radius:8px;border:0;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35);font-size:18px;cursor:pointer}
</style></head>
<body><div id="map"></div><div id="badge"></div>
<div id="legend"><div><i class="d" style="background:#dc2626"></i>Plant (start)</div><div><i class="d" style="background:#16a34a"></i>Site (destination)</div><div><i class="l" style="background:#9ca3af"></i>Travelled</div><div><i class="l" style="background:#0284c7"></i>Remaining</div><div id="note" style="display:none;color:#b45309;font-size:9px;max-width:150px;line-height:12px;margin-top:3px"></div></div>
<button id="recenter" title="Show the whole route">&#9678;</button>
<script>
  var map=L.map('map',{zoomControl:true}).setView([21.1458,79.0882],5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  var lines=L.layerGroup().addTo(map), marks=L.layerGroup().addTo(map), moving=L.layerGroup().addTo(map);
  var last=null, lastTruck=null, fittedKey='';
  // Truck layer: created once, then only moved/turned (it changes ~15 times a second while driving).
  var truckMarker=null, truckKey='', trailCasing=null, trailLine=null, follow=true, targetKey='';
  map.on('dragstart',function(){follow=false;});
  function ll(p){return [p.lat,p.lng];}
  function dot(p,color,label){L.marker(ll(p),{icon:L.divIcon({className:'',html:'<div class="dot" style="background:'+color+'"></div>',iconSize:[20,20],iconAnchor:[10,10]})}).bindTooltip(label||'').addTo(marks);}
  function fit(d){
    var pts=[];
    if(d.phase==='arrived'){d.gray.forEach(function(s){s.forEach(function(p){pts.push(ll(p));});});}
    else{if(lastTruck)pts.push(ll(lastTruck));d.blue.forEach(function(p){pts.push(ll(p));});if(d.phase==='planned'&&d.plant)pts.push(ll(d.plant));}
    if(d.dest)pts.push(ll(d.dest));
    if(!pts.length&&d.plant)pts.push(ll(d.plant));
    if(pts.length>1)map.fitBounds(pts,{paddingTopLeft:[40,140],paddingBottomRight:[50,50]});else if(pts.length===1)map.setView(pts[0],16);
  }
  function onLines(d){
    last=d;
    document.getElementById('badge').textContent=d.badge||'';
    var note=document.getElementById('note');
    note.textContent=d.note?'Road route unavailable: '+d.note:'';
    note.style.display=d.note?'block':'none';
    lines.clearLayers(); marks.clearLayers();
    if(d.blue.length>1){
      if(!d.fallback)L.polyline(d.blue.map(ll),{color:'#0c4a6e',opacity:.55,weight:8}).addTo(lines);
      L.polyline(d.blue.map(ll),{color:d.fallback?'#f59e0b':'#0284c7',weight:5,lineCap:'round',dashArray:d.fallback?'14 10':null}).addTo(lines);
    }
    d.gray.forEach(function(s){
      L.polyline(s.map(ll),{color:'#374151',opacity:.45,weight:8}).addTo(lines);
      L.polyline(s.map(ll),{color:'#9ca3af',weight:5,lineCap:'round'}).addTo(lines);
    });
    if(d.plant)dot(d.plant,'#dc2626','Plant (start)'+(d.plantLabel?' · '+d.plantLabel:''));
    if(d.dest)dot(d.dest,'#16a34a','Site (destination)'+(d.destLabel?' · '+d.destLabel:''));
    var key=d.key+'|'+d.phase+'|'+(d.ready?1:0);
    if(d.ready&&key!==fittedKey){fittedKey=key;follow=true;fit(d);}
  }
  function onTruck(d){
    lastTruck=d.truck||null;
    // Road piece the truck is driving over right now: gray, on top of the blue line.
    var trail=(d.trail||[]).map(ll);
    if(trail.length>1){
      if(!trailLine){
        trailCasing=L.polyline(trail,{color:'#374151',opacity:.45,weight:8}).addTo(moving);
        trailLine=L.polyline(trail,{color:'#9ca3af',weight:5,lineCap:'round'}).addTo(moving);
      }else{trailCasing.setLatLngs(trail);trailLine.setLatLngs(trail);}
    }else if(trailLine){moving.removeLayer(trailCasing);moving.removeLayer(trailLine);trailCasing=trailLine=null;}
    if(!d.truck){
      if(truckMarker){map.removeLayer(truckMarker);truckMarker=null;truckKey='';}
      return;
    }
    var key=(d.live?'1':'0')+'|'+(d.vehicle||'');
    if(!truckMarker||key!==truckKey){
      if(truckMarker)map.removeLayer(truckMarker);
      var html='<div style="position:relative;width:60px;height:60px"><div class="halo'+(d.live?' live':'')+'"></div><img class="truck" style="position:absolute;left:16px;top:2px" src="'+d.truckSrc+'"/></div>';
      truckMarker=L.marker(ll(d.truck),{icon:L.divIcon({className:'',html:html,iconSize:[60,60],iconAnchor:[30,30]}),zIndexOffset:1000}).bindTooltip('Truck'+(d.vehicle?' · '+d.vehicle:'')).addTo(map);
      truckKey=key;
    }else{truckMarker.setLatLng(ll(d.truck));}
    var el=truckMarker.getElement();var img=el?el.querySelector('img.truck'):null;
    if(img)img.style.transform='rotate('+(d.heading||0)+'deg)';
    // Follow the truck (until the map is dragged): one glide per GPS position.
    if(d.live&&d.target){
      var tk=d.target.lat+','+d.target.lng;
      if(tk!==targetKey){
        targetKey=tk;
        if(follow&&fittedKey)map.panTo(ll(d.target),{animate:true,duration:Math.max(0.3,(d.moveMs||600)/1000),easeLinearity:1});
      }
    }
  }
  window.addEventListener('message',function(e){
    var d=e.data; if(!d)return;
    if(d.type==='update')onLines(d);
    else if(d.type==='truck')onTruck(d);
  });
  document.getElementById('recenter').onclick=function(){follow=true;if(last)fit(last);};
  parent.postMessage({type:'ready'},'*');
</script></body></html>`;

const TRUCK_IMAGE_ASSET = require('../../assets/images/truck-top.png');

const getTruckSrc = (): string => {
  try {
    const resolved = Image.resolveAssetSource(TRUCK_IMAGE_ASSET);
    if (resolved?.uri) return resolved.uri;
  } catch {}
  return `data:image/svg+xml;utf8,${encodeURIComponent(TRUCK_SVG)}`;
};

const TRUCK_SRC = getTruckSrc();

export const GoogleRouteMap: React.FC<GoogleRouteMapProps> = ({
  dispatchKey,
  plantCoord,
  destCoord,
  liveCoord,
  liveHeading,
  liveAccuracy,
  phase: phaseProp,
  historyCoords,
  plantLabel = '',
  destLabel = 'Destination Site',
  vehicleNumber = '',
  isArrived = false,
}) => {
  const phase: RoutePhase = phaseProp ?? (isArrived ? 'arrived' : 'inTransit');
  const route = useRouteTracker({
    dispatchKey,
    plantCoord,
    destCoord,
    liveCoord,
    liveHeading,
    liveAccuracy,
    phase,
    historyCoords,
  });

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);

  // iframe tells us when Leaflet is loaded and ready for data.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source === iframeRef.current?.contentWindow && e.data?.type === 'ready') setReady(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const badge = !route.ready
    ? 'LOADING ROUTE…'
    : phase === 'arrived'
      ? 'JOURNEY COMPLETED'
      : phase === 'planned'
        ? 'PLANNED ROUTE'
        : route.live
          ? 'LIVE'
          : route.truck
            ? 'LAST SAVED POSITION'
            : 'SEARCHING GPS…';

  const showTruck = phase !== 'planned' && !!route.truck;
  const isLive = route.live && phase === 'inTransit';

  // Truck (moves ~15 times a second while it is driving): a small message of its own,
  // sent BEFORE the lines so the first "fit" already knows where the truck is.
  useEffect(() => {
    if (!ready) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'truck',
        truck: showTruck ? route.truck : null,
        heading: route.heading,
        live: isLive,
        trail: showTruck ? route.trail : [],
        target: route.truckTarget,
        moveMs: route.moveMs,
        vehicle: vehicleNumber,
        truckSrc: TRUCK_SRC,
      },
      '*'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showTruck, isLive, route.truck, route.heading, route.trail, vehicleNumber]);

  // Lines, dots and badge: only when one of them really changes.
  const plantLat = route.plant?.lat;
  const plantLng = route.plant?.lng;
  const destLat = route.dest?.lat;
  const destLng = route.dest?.lng;
  useEffect(() => {
    if (!ready) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'update',
        key: dispatchKey ?? '',
        phase,
        ready: route.ready,
        badge,
        plant: route.plant,
        dest: route.dest,
        plantLabel,
        destLabel,
        gray: route.gray,
        blue: route.blue,
        fallback: route.fallback,
        note: route.fallback ? getRoadRouteProblem() ?? 'Google gave no road route' : '',
      },
      '*'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    dispatchKey,
    phase,
    badge,
    plantLabel,
    destLabel,
    route.ready,
    route.gray,
    route.blue,
    route.fallback,
    plantLat,
    plantLng,
    destLat,
    destLng,
  ]);

  return (
    <View style={styles.wrap}>
      {React.createElement('iframe', {
        ref: iframeRef,
        srcDoc: MAP_HTML,
        title: 'Route map',
        // No `sandbox` attribute: a sandboxed srcDoc frame sends its tile requests
        // without a Referer header, and OpenStreetMap answers those with its
        // "access blocked" tile instead of the map.
        style: { border: 0, width: '100%', height: '100%' },
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, position: 'relative', backgroundColor: '#e8f0e9' },
});
