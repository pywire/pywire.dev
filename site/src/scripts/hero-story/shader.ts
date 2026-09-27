// "The live conduit" fragment shader.
//
// One full-screen pass draws the circuit board behind the hero story in world
// space (CSS px, origin bottom-left), seen through a 2D camera `u_cam` =
// (x, y, zoom). The server card and browser window are HTML laid over the top;
// the shader draws everything between and around them:
//   - the grid and a board of short traces that conduct now and then; scrolling
//     speeds up the clock that drives them (u_flow) and brightens them (u_energy)
//   - the server and browser footprints, which "compile" out of grid cells as
//     they appear (u_srvOn, u_brwOn) and glow when they fire (u_srvHit, u_brwHit)
//   - the conduit between them, drawn in (u_draw), the tangle of old-stack
//     routes that merges into it (u_stack), and the three transport lanes it
//     splits into (u_tx)
//   - arcs: an event or a patch crossing the wire. u_arcUp / u_arcDn are
//     (head distance, intensity, lane, unused); they cross in a few frames and
//     light the whole wire at once, like current, instead of travelling.
export const storyFrag = `precision highp float;
uniform vec2 u_res;uniform float u_time;uniform float u_light;uniform float u_px;
uniform vec3 u_bg;uniform vec3 u_ink;uniform vec3 u_acc;
uniform vec3 u_cam;uniform float u_out;uniform float u_amb;uniform float u_flow;uniform float u_energy;
uniform vec4 u_srv;uniform vec4 u_brw;uniform vec2 u_ta;uniform vec2 u_tb;uniform float u_vert;
uniform float u_srvOn;uniform float u_brwOn;uniform float u_srvHit;uniform float u_brwHit;uniform float u_conv;
uniform float u_draw;uniform vec2 u_stack;uniform float u_tx;uniform vec4 u_arcUp;uniform vec4 u_arcDn;
const float C=32.0;
float aa,W,Z;
float h1(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ln(float d,float w){return 1.0-smoothstep(w*W,w*W+aa,d);}
vec2 segH(vec2 p,float x0,float x1,float y){float lo=min(x0,x1),hi=max(x0,x1);float dx=max(0.0,max(lo-p.x,p.x-hi));return vec2(length(vec2(dx,p.y-y)),clamp(abs(p.x-x0),0.0,hi-lo));}
// A three-segment routed wire A -> B, shifted sideways by o with its middle
// run moved by sh. Returns distance to it, distance along it, and its length.
vec3 lane(vec2 p,vec2 A,vec2 B,float o,float sh){
  float sx=B.x>=A.x?1.0:-1.0;float sy=B.y>=A.y?1.0:-1.0;
  float mx=floor((A.x+B.x)*0.5/C+0.5)*C+sh-o*sx*sy;
  float y0=A.y+o,y1=B.y+o;
  vec2 a=segH(p,A.x,mx,y0);float l1=abs(mx-A.x);
  vec2 b=segH(p.yx,y0,y1,mx);float l2=abs(y1-y0);
  vec2 c=segH(p,mx,B.x,y1);float l3=abs(B.x-mx);
  vec3 r=vec3(a.x,a.y,0.0);
  if(b.x<r.x)r=vec3(b.x,l1+b.y,0.0);
  if(c.x<r.x)r=vec3(c.x,l1+l2+c.y,0.0);
  r.z=l1+l2+l3;return r;
}
// Distance from p to segment a-b, and distance along it.
vec2 seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/(dot(ba,ba)+1e-6),0.0,1.0);return vec2(length(pa-ba*h),h*length(ba));}
float sdBox(vec2 p,vec4 r){vec2 d=abs(p-r.xy)-r.zw;return length(max(d,0.0))+min(max(d.x,d.y),0.0);}
// Light from an arc on a lane: the whole wire behind the head, plus a hot core.
float arc(vec3 r,vec4 a,float dir){
  if(a.y<=0.001)return 0.0;
  float q=dir>0.0?r.y:r.z-r.y;
  float lit=step(q,a.x)*a.y;
  float core=exp(-abs(q-a.x)/6.0)*step(a.x,r.z-1.0)*a.y;
  return max(lit*0.85,core*1.4);
}
// A bus in the board block around g, on the layer picked by sd. Returns trace
// coverage, conduction light, and unused. u_flow is a clock that runs faster
// while the page scrolls; more buses fire as u_energy rises.
vec3 bus(vec2 g,float sd){
  const float BK=10.0;const float SP=7.0;
  float row=floor(g.y/BK+sd);float sft=floor(h1(row+sd*13.0)*BK);
  float col=floor((g.x+sft)/BK);vec2 bo=vec2(col*BK-sft,(row-sd)*BK);
  vec2 bi=vec2(col,row)+sd*37.0;
  if(h2(bi+0.37)>0.62)return vec3(0.0);
  vec2 A=bo+vec2(1.0+floor(h2(bi+1.1)*8.0),1.0+floor(h2(bi+2.3)*8.0))+0.5;
  vec2 B=bo+vec2(1.0+floor(h2(bi+4.7)*8.0),1.0+floor(h2(bi+6.1)*8.0))+0.5;
  if(abs(B.x-A.x)+abs(B.y-A.y)<4.0)B.x=A.x<bo.x+5.0?bo.x+8.5:bo.x+1.5;
  vec2 d=B-A;vec2 ad=abs(d);vec2 sg=sign(d+0.001);
  // Straight run, a 45 degree jog, then straight again.
  vec2 P1,P2;
  if(ad.x>=ad.y){float k=floor((ad.x-ad.y)*h2(bi+8.9)+0.5);P1=vec2(A.x+sg.x*k,A.y);P2=vec2(P1.x+sg.x*ad.y,B.y);}
  else{float k=floor((ad.y-ad.x)*h2(bi+8.9)+0.5);P1=vec2(A.x,A.y+sg.y*k);P2=vec2(B.x,P1.y+sg.y*ad.x);}
  vec2 s1=seg(g,A,P1),s2=seg(g,P1,P2),s3=seg(g,P2,B);
  float l1=length(P1-A),l2=length(P2-P1),Lt=l1+l2+length(B-P2);
  vec2 a0=A,a1=P1;vec2 r=s1;
  if(s2.x<r.x){r=vec2(s2.x,l1+s2.y);a0=P1;a1=P2;}
  if(s3.x<r.x){r=vec2(s3.x,l1+l2+s3.y);a0=P2;a1=B;}
  vec2 e=a1-a0;float side=sign(e.x*(g.y-a0.y)-e.y*(g.x-a0.x)+1e-5);
  float sdist=side*r.x*C;
  float n=1.0+floor(h2(bi+9.7)*3.0);
  // Traces run parallel on the left of the route; ends stop square at pads.
  float inner=step(0.01,r.y)*step(r.y,Lt-0.01);
  float lines=0.0;
  for(int k=0;k<3;k++){if(float(k)>=n)break;lines=max(lines,ln(abs(sdist-float(k)*SP),1.1));}
  lines*=inner*step(-3.0,sdist);
  vec2 dA=l1>0.01?P1-A:(l2>0.01?P2-P1:B-P2);vec2 dB=length(B-P2)>0.01?B-P2:(l2>0.01?P2-P1:P1-A);
  vec2 nA=normalize(vec2(-dA.y,dA.x))*SP/C,nB=normalize(vec2(-dB.y,dB.x))*SP/C;
  float pA=1e3,pB=1e3;
  for(int k=0;k<3;k++){if(float(k)>=n)break;vec2 q=vec2(float(k));
    vec2 ea=abs(g-A-nA*q.x)*C;vec2 eb=abs(g-B-nB*q.x)*C;
    pA=min(pA,max(ea.x,ea.y));pB=min(pB,max(eb.x,eb.y));}
  float pads=max(ln(max(pA-1.8,0.0),1.0),ln(max(pB-1.8,0.0),1.0));
  // Conduction: each cycle a bus may fire, from either end.
  float P=1.8+1.8*h2(bi+3.3);float cyc=u_flow/P+h2(bi+5.5);float cn=floor(cyc);
  float age=fract(cyc)*P;
  float fire=step(h2(bi+cn*1.7),0.3+0.55*u_energy);
  float fwd=step(0.5,h2(bi+cn*2.9));
  float q=(fwd>0.5?r.y:Lt-r.y)*C;float L=Lt*C;
  float head=age*1400.0;float done=L/1400.0;
  float lit=step(q,head)*exp(-max(age-done,0.0)*2.2);
  float core=exp(-abs(q-head)/5.0)*step(head,L);
  float land=step(done,age)*exp(-(age-done)*3.0)*(fwd>0.5?ln(max(pB-1.8,0.0),1.0):ln(max(pA-1.8,0.0),1.0));
  float cur=fire*max(max(lit,core*1.4)*lines,land);
  return vec3(max(lines,pads),cur,0.0);
}
void main(){
  vec2 size=u_res/u_px;Z=u_cam.z;aa=1.0/(u_px*Z);W=0.5/Z;
  vec2 scr=gl_FragCoord.xy/u_px;
  vec2 css=(scr-size*0.5)/Z+u_cam.xy;
  vec2 g=css/C;vec2 gi=floor(g);vec2 gf=fract(g);
  vec2 dl=min(gf,1.0-gf)*C;
  float gx=ln(dl.x,1.0),gy=ln(dl.y,1.0);float gridL=max(gx,gy);vec2 li=floor(g+0.5);
  float major=max(gx*step(mod(li.x,4.0),0.5),gy*step(mod(li.y,4.0),0.5));
  vec2 inset=step(vec2(3.0),gf*C)*step(gf*C,vec2(C-3.0));float insq=inset.x*inset.y;
  vec2 cc=(gi+0.5)*C;

  // Server and browser footprints.
  float sdS=sdBox(css,u_srv);float sdB=sdBox(css,u_brw);
  float inS=step(sdBox(cc,u_srv),0.0);float inB=step(sdBox(cc,u_brw),0.0);
  float tS=h2(gi)*0.55;float onS=smoothstep(tS,tS+0.25,u_srvOn);
  float fS=inS*insq*onS*(1.0-smoothstep(tS+0.25,tS+0.55,u_srvOn));
  vec2 dpB=abs(cc-u_tb);float tB=clamp((dpB.x+dpB.y)/max(1.0,2.0*(u_brw.z+u_brw.w)),0.0,1.0)*0.6+h2(gi+3.0)*0.12;
  float onB=smoothstep(tB,tB+0.2,u_brwOn);
  float fB=inB*insq*onB*(1.0-smoothstep(tB+0.2,tB+0.5,u_brwOn));
  float haloS=exp(-max(sdS,0.0)/(26.0+30.0*u_srvHit))*u_srvOn*(0.25+0.9*u_srvHit)*step(0.0,sdS);
  float haloB=exp(-max(sdB,0.0)/(26.0+30.0*u_brwHit))*u_brwOn*(0.2+0.9*u_brwHit)*step(0.0,sdB);
  // Signals converging into the server while it compiles.
  float Ls=max(abs(css.x-u_srv.x)-u_srv.z,0.0)+max(abs(css.y-u_srv.y)-u_srv.w,0.0);
  float sel=max(gx*step(0.4,h1(li.y+5.0)),gy*step(0.4,h1(li.x+9.0)));
  float inW=pow(1.0-fract(Ls/224.0+u_time*0.8),9.0)*sel*u_conv*(0.3+0.7*exp(-Ls/700.0))*step(4.0,sdS);

  // The board: buses of one to three traces between pads, routed with 45 degree
  // jogs like a circuit board, on two layers (the lower one dimmer). Now and
  // then a bus conducts and lights end to end almost at once.
  vec3 top=bus(g,0.0),bot=bus(g,0.5);
  float clr=mix(1.0,smoothstep(8.0,56.0,sdS),u_srvOn)*mix(1.0,smoothstep(8.0,56.0,sdB),u_brwOn);
  float trace=max(top.x,bot.x*0.5)*clr;
  float cur=max(top.y,bot.y*0.55)*clr*(0.8+0.5*u_energy);

  // Wires.
  float wire=0.0,spark=0.0,glow=0.0,stack=0.0;
  if(u_draw>0.001){
    vec2 P=css,A=u_ta,B=u_tb;if(u_vert>0.5){P=P.yx;A=A.yx;B=B.yx;}
    for(int k=-1;k<=1;k++){
      float fk=float(k);
      if(k!=0&&u_tx<0.001)continue;
      vec3 r=lane(P,A,B,fk*C*u_tx,0.0);
      float head=r.z*u_draw;
      float vis=step(r.y,head+0.5)*(k==0?1.0:smoothstep(0.0,0.4,u_tx));
      wire=max(wire,ln(r.x,1.3)*vis);
      float tip=exp(-abs(r.y-head)/16.0)*(1.0-step(0.999,u_draw))*vis;
      float up=arc(r,u_arcUp,-1.0)*step(abs(u_arcUp.z-fk),0.5);
      float dn=arc(r,u_arcDn,1.0)*step(abs(u_arcDn.z-fk),0.5);
      float a=max(max(up,dn),tip)*vis;
      spark=max(spark,a*ln(r.x,2.2));
      glow=max(glow,a*exp(-r.x*0.2*Z));
    }
    // The old stack: alternate routes that merge into the one conduit.
    if(u_stack.x>0.001){
      float m=u_stack.y;
      for(int k=0;k<3;k++){
        float fk=float(k);
        float o=(fk==0.0?-48.0:fk==1.0?40.0:88.0)*(1.0-m);
        float sh=(fk==0.0?-128.0:fk==1.0?96.0:192.0)*(1.0-m);
        vec3 r=lane(P,A,B,o,sh);
        float dash=step(0.45,fract(r.y/12.0-u_time*(0.6+0.3*fk)));
        stack=max(stack,ln(r.x,1.2)*dash);
      }
      stack*=u_stack.x*(1.0-m);
    }
  }

  float ph=u_time*0.5+h2(gi)*20.0;
  float fl=step(0.975,h2(gi+floor(ph)*1.37))*pow(1.0-fract(ph),2.0)*insq*(1.0-inS*u_srvOn)*(1.0-inB*u_brwOn);
  vec3 col=u_bg;
  col=mix(col,u_ink,gridL*mix(0.06,0.12,major));
  col=mix(col,u_acc,fl*0.16*u_amb);
  col=mix(col,u_ink,clamp(trace*0.2*u_amb,0.0,1.0));
  col=mix(col,u_acc,clamp(cur*u_amb,0.0,1.0));
  col=mix(col,u_ink,clamp(stack*0.45,0.0,1.0));
  col=mix(col,u_acc,clamp(inW+fS*0.7+fB*0.7,0.0,1.0));
  col=mix(col,u_acc,clamp(wire*0.45+spark,0.0,1.0));
  float halo=haloS+haloB;
  col+=(u_acc*(halo*0.22+glow*0.35+cur*u_amb*0.18))*(1.0-u_light);
  col=mix(col,u_acc,clamp((halo*0.12+glow*0.25)*u_light,0.0,1.0));
  vec2 uv=gl_FragCoord.xy/u_res;
  float vg=smoothstep(1.25,0.4,length((uv-0.5)*vec2(1.3,1.0)));
  col=mix(u_bg,col,mix(0.55,1.0,vg));
  gl_FragColor=vec4(mix(col,u_bg,u_out),1.0);
}`
