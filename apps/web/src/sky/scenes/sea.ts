// @ts-nocheck: the Ra design canvas's own scene code (App UI v2, U4 Ray: the sea under a setting sun or the moon, shared by every board with a sea; each passes its own options), copied verbatim from the board.
// Called as scene(THREE, renderer, options, colours) → { size(w, h), frame(t, colours), dispose() }.

export default function sea(T, r, O, c) {
  return (function (T, r, O) {
  var STARS = {"signal":{"core":null,"limb":null,"r":1,"gr":0,"sp":0,"cor":1.15,"spk":0,"soft":0,"fl":0,"hot":1},"yellow":{"core":"#FFF8EC","limb":"#FFB13B","r":1,"gr":0.8,"sp":0.1,"cor":1,"spk":0,"soft":0,"fl":0},"orange":{"core":"#FFE4C4","limb":"#FF8233","r":0.86,"gr":0.9,"sp":0.28,"cor":0.95,"spk":0,"soft":0,"fl":0},"red-dwarf":{"core":"#FFC09A","limb":"#E0402A","r":0.62,"gr":1,"sp":0.45,"cor":0.8,"spk":0,"soft":0.2,"fl":1},"white-dwarf":{"core":"#FFFFFF","limb":"#A8C2FF","r":0.24,"gr":0,"sp":0,"cor":2.2,"spk":1,"soft":0,"fl":0},"blue-giant":{"core":"#F3F6FF","limb":"#7EA4FF","r":1.35,"gr":0.35,"sp":0,"cor":1.6,"spk":0.55,"soft":0,"fl":0},"red-giant":{"core":"#FFB07A","limb":"#C7371D","r":2,"gr":1.4,"sp":0.6,"cor":0.85,"spk":0,"soft":1,"fl":0}};
  var sc = new T.Scene(), oc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var U = {
    uRes: { value: new T.Vector2(1, 1) }, uT: { value: 0 }, uHz: { value: 0 }, uSun: { value: new T.Vector2() }, uR: { value: 10 }, uR0: { value: 10 },
    uBg: { value: new T.Color() }, uInk: { value: new T.Color() }, uSig: { value: new T.Color() }, uHi: { value: new T.Color() }, uCore: { value: new T.Color() }, uLimb: { value: new T.Color() },
    uV: { value: 0 }, uDark: { value: 1 }, uDpr: { value: 1 }, uFocal: { value: 3.7 }, uCam: { value: 1 }, uCell: { value: 0.11 }, uOn: { value: 1 }, uBeam: { value: O.beam ? 1 : 0 }, uAng: { value: 0 },
    uGr: { value: 0 }, uHot: { value: 0 }, uSpots: { value: 0 }, uCor: { value: 1 }, uSpike: { value: 0 }, uSoft: { value: 0 }, uFlare: { value: 0 },
    uStars: { value: 0 }, uBody: { value: O.body === 'moon' ? 1 : 0 }, uPhase: { value: O.phase || 0.2 }, uCloud: { value: O.cloud !== undefined ? O.cloud : 0.6 }, uFade: { value: O.fade !== undefined ? O.fade : 0.16 }
  };
  var vs = 'void main(){gl_Position=vec4(position.xy,0.,1.);}';
  var fs = [
    'precision highp float;',
    'uniform vec2 uRes,uSun;uniform float uT,uHz,uR,uR0,uV,uDark,uDpr,uFocal,uCam,uCell,uOn,uBeam,uAng,uGr,uSpots,uCor,uSpike,uSoft,uFlare,uStars,uBody,uPhase,uCloud,uFade,uHot;',
    'uniform vec3 uBg,uInk,uSig,uHi,uCore,uLimb;',
    "float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}\nfloat vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}\nfloat fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}\nfloat cells(vec2 p,float t){vec2 i=floor(p),f=fract(p);float d=1.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 o=vec2(h21(i+g),h21(i+g+3.1));o=.5+.4*sin(t*.35+6.2831*o);d=min(d,length(g+o-f));}return d;}\nvec4 starShade(vec2 d,float R,vec3 core,vec3 limb,float gr,float spots,float cor,float spike,float soft,float flare,float t,float dpr){\n float r=length(d);float sw=soft*R*.10+.8*dpr;float disk=smoothstep(R+sw,R-sw,r);\n vec2 p=d/R;float rr=min(length(p),1.);float mu=sqrt(max(0.,1.-rr*rr));\n vec3 s=mix(limb,core,.22+.78*pow(mu,.5));\n vec3 hot=mix(vec3(1.,.975,.95),limb,smoothstep(0.,1.,pow(rr,1.15)));hot=mix(hot,vec3(1.),pow(1.-rr,5.)*.5);s=mix(s,hot,uHot);\n float g=cells(p*mix(15.,4.5,soft)+vec2(t*.015,0.),t);s*=1.-gr*.13*smoothstep(.15,.8,g)-gr*.04*vn(p*40.+t*.2);\n float spt=smoothstep(.6,.7,fbm(p*2.2+vec2(9.1,t*.003)))*spots;s=mix(s,limb*.42,spt*smoothstep(0.,.3,mu));\n s+=core*flare*pow(max(0.,sin(t*.6)),24.)*exp(-length(p-vec2(.62,.55))*7.)*1.6;\n float o=max(r-R,0.);float ang=atan(d.y,d.x);\n float str=.7+.3*vn(vec2(ang*3.,t*.05))+.25*vn(vec2(ang*9.,t*.07+3.));\n float glow=.45*exp(-o/(R*.06))+.30*exp(-o/(R*.42*cor))+.11*exp(-o/(R*1.7*cor))*str;\n float cell=clamp(R*.085,2.6*dpr,4.6*dpr);vec2 gc=(floor(d/cell)+.5)*cell;float rg=length(gc);\n float I=(1.-smoothstep(R*1.02,R*(1.4+.65*cor),rg))*step(R*1.05,rg)*str;float hr=cell*.42*sqrt(I);\n float ht=smoothstep(hr+.6*dpr,hr-.6*dpr,length(d-gc))*step(.03,I);\n float fr=abs(fract(ang/6.28318*120.+t*.003)-.5)*(6.28318/120.)*r;\n float ray=(1.-smoothstep(0.,.7*dpr,fr))*(1.-smoothstep(R*1.3,R*(1.8+1.4*cor),r))*step(R*1.2,r)*.22;\n float spk=(exp(-abs(d.x)/(.8*dpr))*exp(-abs(d.y)/(R*5.5))+exp(-abs(d.y)/(.8*dpr))*exp(-abs(d.x)/(R*5.5)))*spike*(1.-disk);\n float ga=clamp(glow+ht*.55+ray+spk,0.,1.);\n vec3 col=mix(limb,s,disk);col=mix(col,core,clamp(spk*.8,0.,1.)*(1.-disk));\n return vec4(col,max(disk,ga));}",
    // the surface: a long swell, wind waves, and ripples that spread from you while you talk
    'vec3 wave(vec2 p,float t,float a,float v){vec3 r=vec3(0.);float ph;vec2 d;',
    ' d=normalize(vec2(-.15,1.));ph=dot(d,p)*.55+t*.7;r+=vec3(sin(ph),cos(ph)*.55*d)*.09;',
    ' d=normalize(vec2(.3,1.));ph=dot(d,p)*1.6+t*1.25;r+=vec3(sin(ph),cos(ph)*1.6*d)*.05*a;',
    ' d=normalize(vec2(-.7,1.));ph=dot(d,p)*2.7+t*1.9;r+=vec3(sin(ph),cos(ph)*2.7*d)*.028*a;',
    ' d=normalize(vec2(1.,.35));ph=dot(d,p)*4.3+t*2.6;r+=vec3(sin(ph),cos(ph)*4.3*d)*.016*a;',
    ' d=normalize(vec2(-.2,-1.));ph=dot(d,p)*7.1+t*3.4;r+=vec3(sin(ph),cos(ph)*7.1*d)*.009*a;',
    ' d=normalize(vec2(.9,-.4));ph=dot(d,p)*11.3+t*4.6;r+=vec3(sin(ph),cos(ph)*11.3*d)*.004*a;',
    ' vec2 rc=p-vec2(0.,-3.4);float rl=length(rc)+1e-3;float rph=rl*7.-t*5.;float ra=v*.016*exp(-rl*.32);r+=vec3(sin(rph)*ra,cos(rph)*7.*ra*rc/rl);',
    ' return r;}',
    'float beamD(vec3 ro,vec3 rd,vec3 s,vec3 b,out float along){vec3 w=ro-s;float A=dot(rd,rd),B=dot(rd,b),C=dot(b,b),D=dot(rd,w),E=dot(b,w);float den=max(A*C-B*B,1e-5);float tr=max((B*E-C*D)/den,0.);along=max((A*E-B*D)/den,0.);return length((ro+rd*tr)-(s+b*along));}',
    // the sky's own stars, a few of them warm or cool
    'vec4 starsF(vec2 f){float cs=11.*uDpr;vec2 c=floor(f/cs);float b=h21(c+11.7);if(b<.82)return vec4(0.);',
    ' vec2 o=vec2(h21(c),h21(c+5.3))*.8+.1;vec2 p=(c+o)*cs;float d=length(f-p);float k=(b-.82)/.18;',
    ' float sz=(.45+1.25*k*k*k)*uDpr;float tw=.55+.45*sin(uT*(.6+2.4*h21(c+2.))+b*40.);',
    ' float m=smoothstep(sz+.6*uDpr,sz-.4*uDpr,d)*tw*(.35+.65*k);float hu=h21(c+9.);',
    ' vec3 sc=hu<.12?vec3(1.,.82,.66):hu>.9?vec3(.75,.85,1.):vec3(1.);return vec4(sc*m,m);}',
    // the moon: a phase lit by the sun, maria and craters, earthshine on the dark side, a halo
    'vec4 moonShade(vec2 d,float R,float ph,float t,float dpr){',
    ' float r=length(d);float disk=smoothstep(R+.8*dpr,R-.8*dpr,r);vec2 p=d/R;float z=sqrt(max(0.,1.-min(dot(p,p),1.)));vec3 n=vec3(p,z);',
    ' float th=ph*6.2832;vec3 L=normalize(vec3(sin(th),.12,-cos(th)));float lit=smoothstep(-.05,.18,dot(n,L));',
    ' float mar=fbm(p*1.7+vec2(3.,1.))*.65+fbm(p*5.+7.)*.35;float tone=.82-.34*smoothstep(.48,.72,mar);',
    ' tone+=exp(-pow(length(p-vec2(-.30,-.52))/.07,2.))*.22+exp(-pow(length(p-vec2(.34,.30))/.09,2.))*.12+exp(-pow(length(p-vec2(.55,-.18))/.05,2.))*.12;',
    ' vec3 mc=vec3(.93,.94,.96)*tone*(.72+.28*z);vec3 es=vec3(.10,.12,.18)*(.6+.4*tone);vec3 s=mix(es,mc,lit);',
    ' float pb=.5-.5*cos(th);float o=max(r-R,0.);float glow=(.22*exp(-o/(R*.5))+.08*exp(-o/(R*2.4)))*(.35+.65*pb);',
    ' float halo=exp(-pow((r-R*5.)/(R*.3),2.))*.05+exp(-pow((r-R*5.35)/(R*.5),2.))*.02;',
    ' return vec4(mix(vec3(.80,.85,.95),s,disk),max(disk,clamp(glow+halo,0.,1.)));}',
    'void main(){',
    ' vec2 f=gl_FragCoord.xy;vec3 col=uBg;float a=0.;',
    ' vec2 q=(f-vec2(uRes.x*.5,uHz))/(uRes.y*.5);vec3 rd=normalize(vec3(q,-uFocal));',
    ' vec2 sq=(uSun-vec2(uRes.x*.5,uHz))/(uRes.y*.5);vec3 sd=normalize(vec3(sq,-uFocal));vec3 ro=vec3(0.,uCam,0.);vec3 sdw=normalize(vec3(sq.x,min(sq.y,.32),-uFocal));',
    ' vec3 bs=vec3(sq.x/uFocal*40.,1.65,-40.);vec3 bd=normalize(vec3(sin(uAng),-.012,cos(uAng)));',
    ' float bal;float bdst=beamD(ro,rd,bs,bd,bal);float beamG=uBeam*exp(-bdst*bdst/(.12+bal*bal*.006))*exp(-bal/70.)*smoothstep(0.,3.,bal);',
    ' float flash=uBeam*pow(max(dot(bd,normalize(ro-bs)),0.),10.);',
    ' bool moon=uBody>.5;vec3 lc=moon?vec3(.84,.88,1.):uLimb;vec3 gc=moon?vec3(.96,.97,1.):(uDark>.5?mix(uLimb,uCore,.6):uLimb);',
    ' if(f.y<uHz){',
    '  float tt=uCam/max(-rd.y,1e-4);vec2 w=rd.xz*tt;float nr=exp(-tt/9.);',
    '  vec3 wv=wave(w,uT,1.+uV*2.8*nr,uV);vec3 n=normalize(vec3(-wv.y,1.,-wv.z));vec3 rr=reflect(rd,n);',
    '  float cs=max(dot(rr,sdw),0.);float sp=pow(cs,moon?420.:240.)*uOn;float sh=pow(cs,moon?24.:14.)*uOn;',
    '  float fres=.02+.98*pow(1.-max(dot(n,-rd),0.),5.);',
    '  vec3 P=vec3(w.x,0.,w.y);vec3 toP=P-bs;float al=dot(toP,bd);float off=length(toP-bd*max(al,0.));',
    '  float lit=uBeam*step(0.,al)*exp(-off*off/(.7+al*al*.02))*exp(-al/45.);',
    '  vec2 gq=(w+wv.yz*.32)/uCell;vec2 id=floor(gq);vec2 fc=fract(gq)-.5;float fp=max(length(fwidth(gq)),1e-4);',
    '  float crest=smoothstep(-.05,.09,wv.x);float rad=.15+.05*crest*nr;',
    '  float dm=smoothstep(rad+fp*.7,rad-fp*.7,length(fc));float m=mix(dm,3.1416*rad*rad,smoothstep(.22,.55,fp));',
    '  float tw=.5+.5*sin(h21(id)*40.+uT*(2.+h21(id+7.)*3.));',
    '  float glv=clamp(sp*3.4*tw+sh*.4+lit*(.85+.6*tw),0.,1.);float dist=clamp(tt/60.,0.,1.);',
    '  vec3 sea=mix(uBg,uInk,uDark>.5?.028:.035);if(moon)sea=mix(sea,vec3(.04,.05,.09),.5);',
    '  sea=mix(sea,mix(sea,lc,.45),fres*(moon?.1:.3)*uOn*exp(-pow((f.x-uSun.x)/(uRes.x*(moon?.3:.6)),2.)));',
    '  float base=mix(uDark>.5?.16:.21,.04,sqrt(dist))*(.85+.3*crest)*(moon?.55:1.);',
    '  float cap=step(.94,h21(id+floor(uT*1.4)))*smoothstep(.03,.08,wv.x)*nr*uV;',
    '  vec3 dc=mix(uInk,mix(lc,gc,glv*.85),clamp(glv*1.7,0.,1.));',
    '  col=mix(sea,dc,clamp(base+glv*1.6+cap*.7,0.,1.)*m);',
    '  float cw=uR0*(.5+1.1*(1.-exp(-tt/14.)))*(moon?.6:1.);',
    '  float bands=.55+.45*sin(f.y*.35/uDpr+vn(vec2(f.y*.05/uDpr,uT*.6))*6.+uT*1.3);',
    '  float colm=exp(-pow((f.x-uSun.x)/cw,2.))*exp(-(uHz-f.y)/(uRes.y*.8))*uOn*bands;',
    '  col=mix(col,mix(lc,gc,.3),clamp(sh*(moon?.3:.2)+sp*.12+colm*((moon?.2:.12)+.3*sp*tw)+lit*.1,0.,1.));',
    '  col=mix(col,mix(uBg,lc,.14),(1.-smoothstep(0.,22.*uDpr,uHz-f.y))*.32*max(uOn,uBeam));',
    '  col=mix(col,mix(uSig,uHi,.45),clamp(beamG*.8,0.,1.));',
    '  a=1.;',
    ' }else{',
    '  vec4 S=starsF(f)*uStars*smoothstep(uHz+6.*uDpr,uHz+70.*uDpr,f.y);',
    '  if(moon){float ng=smoothstep(uRes.y,uHz,f.y)*.5;vec4 N=vec4(vec3(.05,.065,.11)*ng,ng);S=S+N*(1.-S.a);',
    '   vec4 mm=moonShade(f-uSun,uR,uPhase,uT,uDpr)*uOn;S=vec4(mm.rgb*mm.a,mm.a)+S*(1.-mm.a);',
    '   float cl=fbm(vec2(f.x/(uRes.x*.42)-uT*.012,f.y/(uRes.y*.05)+3.));float band=exp(-pow((f.y-(uSun.y-uR*.4))/(uR*1.4),2.));',
    '   float cloud=smoothstep(.5,.78,cl)*band*uCloud;vec3 cc=mix(vec3(.11,.12,.16),vec3(.80,.84,.94),exp(-length(f-uSun)/(uR*2.4)));',
    '   S=vec4(cc*cloud*.85,cloud*.85)+S*(1.-cloud*.85);',
    '  }else{',
    '   vec2 d=f-uSun;float low=1.-smoothstep(0.,uR0*2.2,uSun.y-uHz);d.y/=1.-.16*low;',
    '   vec3 core=mix(uCore,uLimb,low*.35);',
    '   vec4 st=starShade(d,uR,core,uLimb,uGr,uSpots,uCor,uSpike,uSoft,uFlare,uT,uDpr);st.a*=uOn;',
    '   float atm=exp(-(f.y-uHz)/(uR0*.7))*.14*(1.-smoothstep(0.,uRes.x*.5,abs(f.x-uSun.x)))*uOn;',
    '   S=vec4(uLimb*atm,atm)+S*(1.-atm);S=vec4(st.rgb*st.a,st.a)+S*(1.-st.a);',
    '  }',
    '  float src=uBeam*(smoothstep(5.*uDpr,1.5*uDpr,length(f-uSun))+exp(-length(f-uSun)/(16.*uDpr))*(.35+.65*flash));',
    '  float ba=clamp(beamG+src,0.,1.);S=vec4(mix(uSig,uHi,.5)*ba,ba)+S*(1.-ba);',
    '  S*=(uFade>0.?smoothstep(0.,uRes.y*uFade,uRes.y-f.y):1.);',
    '  col=S.rgb/max(S.a,1e-4);a=S.a;',
    ' }',
    ' float near=exp(-pow((f.x-uSun.x)/(uR0*3.),2.));',
    ' float hl=(1.-smoothstep(0.,1.1*uDpr,abs(f.y-uHz)))*(.26+.5*near*uOn);',
    ' col=mix(col,mix(uInk,lc,near*uOn),hl);a=max(a,hl);',
    ' gl_FragColor=vec4(col,a);',
    '}'
  ].join('\n');
  var mat = new T.ShaderMaterial({ uniforms: U, vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, extensions: { derivatives: true } });
  var quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; sc.add(quad);
  var W = 1, H = 1;
  return {
    size: function (w, h) { W = w; H = h; },
    frame: function (t, c) {
      var dpr = r.getPixelRatio(), w = W * dpr, h = H * dpr, S = STARS[c.star] || STARS.signal, moon = O.body === 'moon';
      U.uRes.value.set(w, h); U.uT.value = t; U.uDpr.value = dpr;
      U.uBg.value.set((O.bg === 'surface' ? c.surface : c.bg) || '#0A0A0A'); U.uInk.value.set(c.text || '#F2F1EE'); U.uSig.value.set(c.sig || '#FF5A1F'); U.uHi.value.set(c.hi || '#FFF3E6');
      U.uCore.value.set(S.core || c.hi || '#FFF3E6'); U.uLimb.value.set(S.limb || c.sig || '#FF5A1F');
      U.uGr.value = S.gr; U.uHot.value = S.hot || 0; U.uSpots.value = S.sp; U.uCor.value = S.cor; U.uSpike.value = S.spk; U.uSoft.value = S.soft; U.uFlare.value = S.fl;
      U.uDark.value = c.dark ? 1 : 0; U.uOn.value = (c.sun === false || O.beam) ? 0 : 1;
      var sink = O.sink || 0;
      U.uStars.value = O.stars !== undefined ? O.stars : (c.dark ? Math.max(0, Math.min(1, (sink - 0.25) / 0.35)) : 0);
      var hz = h * (1 - O.hz); U.uHz.value = hz;
      U.uFocal.value = 1 / Math.tan((O.fov || 30) * Math.PI / 360);
      U.uCell.value = O.cell || 0.11;
      var R0 = (O.sr || 0.15) * w; U.uR0.value = R0; U.uR.value = moon ? R0 : R0 * S.r;
      var rise = O.rise ? Math.min(1, t / 6) : 1, ease = 1 - Math.pow(1 - rise, 3);
      var sy = hz + R0 * ((O.el !== undefined ? O.el : 0.75) - sink * 1.15) - (moon ? 0 : R0 * 0.16 * (0.5 - 0.5 * Math.cos(t * 0.11))) - (1 - ease) * R0 * 1.6;
      U.uSun.value.set((O.sx !== undefined ? O.sx : 0.5) * w, sy);
      U.uAng.value = O.beam ? t * 0.55 : 0;
      var v = 0.1, m = O.voice;
      if (m === 'listen') v = 0.5 + 0.38 * Math.sin(t * 2.3) * Math.sin(t * 0.71 + 1.3) + 0.12 * Math.sin(t * 7.3);
      else if (m === 'speak') v = 0.26 + 0.1 * Math.sin(t * 3.1);
      else if (m === 'calm') v = 0.0;
      U.uV.value = Math.max(0, Math.min(1, v));
      r.render(sc, oc);
    },
    dispose: function () { mat.dispose(); quad.geometry.dispose(); }
  };
})(T, r, O, c);
}
