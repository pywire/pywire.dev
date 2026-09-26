// Camera story fragment shader (ported from the design system's D3 exploration).
//
// One full-screen pass draws the whole scene in world space (CSS px, origin
// bottom-left) seen through a 2D camera `u_cam` = (x, y, zoom). `u_s` (0..1)
// walks the story:
//   0    ambient grid with signals running along random lines
//   0.2  signals converge on the server node
//   0.5  a routed wire draws from the node to the page
//   0.75 diffs radiate from the wire's port and patch a page layout into the grid
// On top of that, the live counter loop drives three extra uniforms:
//   u_pk    distance along the wire of the diff packet (x, server -> browser)
//           and the event packet (y, browser -> server); < 0 means none
//   u_hit   server node flash, 1 on a state change, decays to 0
//   u_patch live card flash, 1 when a diff lands, decays to 0
export const storyFrag = `precision highp float;
uniform vec2 u_res;uniform float u_time;uniform vec2 u_mouse;uniform float u_light;uniform float u_px;
uniform vec3 u_bg;uniform vec3 u_ink;uniform vec3 u_acc;
uniform float u_s;uniform float u_out;uniform vec2 u_node;uniform float u_nodeS;uniform vec4 u_panel;uniform vec2 u_ta;uniform vec2 u_tb;
uniform vec3 u_cam;uniform float u_vert;
uniform vec2 u_pk;uniform float u_hit;uniform float u_patch;uniform float u_live;
const float C=32.0;
float aa,W,Z;
float h1(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ln(float d,float w){return 1.0-smoothstep(w*W,w*W+aa,d);}
vec2 segH(vec2 p,float x0,float x1,float y){float lo=min(x0,x1),hi=max(x0,x1);float dx=max(0.0,max(lo-p.x,p.x-hi));return vec2(length(vec2(dx,p.y-y)),clamp(abs(p.x-x0),0.0,hi-lo));}
// Distance to a three-segment routed wire A -> B, distance along it, total length.
vec3 lane(vec2 p,vec2 A,vec2 B){
  float mx=floor((A.x+B.x)*0.5/C+0.5)*C;
  vec2 a=segH(p,A.x,mx,A.y);float l1=abs(mx-A.x);
  vec2 b=segH(p.yx,A.y,B.y,mx);float l2=abs(B.y-A.y);
  vec2 c=segH(p,mx,B.x,B.y);float l3=abs(B.x-mx);
  vec3 r=vec3(a.x,a.y,0.0);
  if(b.x<r.x)r=vec3(b.x,l1+b.y,0.0);
  if(c.x<r.x)r=vec3(c.x,l1+l2+c.y,0.0);
  r.z=l1+l2+l3;return r;
}
void R(vec4 r,vec2 cc,vec2 css,float id,inout float ins,inout float edg,inout float rid){
  vec2 lo=u_panel.xy+vec2(r.x,1.0-r.y-r.w)*u_panel.zw;vec2 hi=lo+r.zw*u_panel.zw;
  lo=floor(lo/C+0.5)*C;hi=max(floor(hi/C+0.5)*C,lo+C);
  vec2 d=max(lo-css,css-hi);float sd=max(d.x,d.y);
  edg=max(edg,ln(abs(sd),1.2));
  if(cc.x>lo.x&&cc.y>lo.y&&cc.x<hi.x&&cc.y<hi.y){ins=1.0;rid=id;}
}
void main(){
  vec2 size=u_res/u_px;Z=u_cam.z;aa=1.0/(u_px*Z);W=0.5/Z;
  vec2 scr=gl_FragCoord.xy/u_px;
  vec2 css=(scr-size*0.5)/Z+u_cam.xy;
  float s=u_s;
  float p1=smoothstep(0.16,0.26,s);
  float conv=p1*(1.0-smoothstep(0.46,0.56,s));
  float pT=smoothstep(0.46,0.56,s);
  float draw=smoothstep(0.48,0.68,s);
  float p3=smoothstep(0.72,0.8,s);
  float grow=smoothstep(0.74,0.96,s);
  float amb=1.0-0.7*p1;
  vec2 g=css/C;vec2 gi=floor(g);vec2 gf=fract(g);
  vec2 dl=min(gf,1.0-gf)*C;
  float gx=ln(dl.x,1.0),gy=ln(dl.y,1.0);float gridL=max(gx,gy);vec2 li=floor(g+0.5);
  float major=max(gx*step(mod(li.x,4.0),0.5),gy*step(mod(li.y,4.0),0.5));
  vec2 mc=(u_mouse*size-size*0.5)/Z+u_cam.xy;float md=length(css-mc)*Z;
  float near=exp(-md*md/(2.0*150.0*150.0));
  float rr=mod(u_time*170.0,560.0);
  float ring=exp(-pow((md-rr)/16.0,2.0))*(1.0-rr/560.0);
  float cols=size.x/C;float rows=size.y/C;
  float sH=0.0,sV=0.0,hH=0.0,hV=0.0;
  float hr=h1(li.y);
  if(hr>0.7){float head=(fract(u_time*(0.05+0.08*h1(li.y+17.0))+hr*9.0)*1.6-0.3)*cols;
    float x=hr>0.86?cols-g.x:g.x;float dx=head-x;float tail=dx>=0.0?exp(-dx*0.3):exp(dx*5.0);
    float dy=abs(g.y-li.y)*C;sH=tail*ln(dy,1.2);hH=tail*exp(-dy*0.3*Z);}
  float hc=h1(li.x+71.0);
  if(hc>0.86){float head=(fract(u_time*(0.05+0.07*h1(li.x+3.0))+hc*5.0)*1.6-0.3)*rows;
    float dy=head-(rows-g.y);float tail=dy>=0.0?exp(-dy*0.3):exp(dy*5.0);
    float dxl=abs(g.x-li.x)*C;sV=tail*ln(dxl,1.2);hV=tail*exp(-dxl*0.3*Z);}
  vec2 inset=step(vec2(3.0),gf*C)*step(gf*C,vec2(C-3.0));float insq=inset.x*inset.y;
  vec2 cc=(gi+0.5)*C;
  // Server node: a small chip with a pulsing ring, halo and state-change shockwave.
  vec2 dn=abs(css-u_node);float L1=dn.x+dn.y;float nb=max(dn.x,dn.y);
  float sel=max(gx*step(0.4,h1(li.y+5.0)),gy*step(0.4,h1(li.x+9.0)));
  float fall=0.3+0.7*exp(-L1/900.0);
  float inW=pow(1.0-fract(L1/224.0+u_time*0.8),9.0)*sel*conv*fall*step(u_nodeS+4.0,nb);
  float nFill=(1.0-smoothstep(u_nodeS,u_nodeS+aa,nb))*p1;
  float nPulse=0.5+0.5*sin(u_time*(conv>0.5?5.0:3.0));
  float nEdge=ln(abs(nb-(u_nodeS+10.0)),1.2);
  float nRing=nEdge*p1*(0.5+0.5*max(nPulse,u_hit));
  float shock=ln(abs(nb-(u_nodeS+12.0+(1.0-u_hit)*56.0)),1.4)*u_hit*u_hit*p1;
  float halo=exp(-L1/70.0)*p1*(1.0+1.6*u_hit);
  // The wire, its ambient traffic and the live loop's packets.
  float trL=0.0,trP=0.0,trG=0.0;
  if(pT>0.001){
    vec2 P=css,A=u_ta,B=u_tb;if(u_vert>0.5){P=P.yx;A=A.yx;B=B.yx;}
    vec3 r=lane(P,A,B);
    float head=r.z*draw;
    float vis=step(r.y,head+0.5);
    trL=ln(r.x,1.3)*vis;
    float ph=fract(r.y/150.0-u_time*0.9+h1(4.0));
    float pk=pow(ph,14.0)*vis*pT*(1.0-0.8*u_live);
    float tip=exp(-abs(r.y-head)/18.0)*(1.0-step(0.999,draw))*vis;
    float dd=r.y-u_pk.x;
    float diff=step(0.0,u_pk.x)*(exp(-abs(dd)/5.0)+step(dd,0.0)*exp(dd/90.0)*0.7);
    float de=r.y-u_pk.y;
    float ev=step(0.0,u_pk.y)*(exp(-abs(de)/5.0)+step(0.0,de)*exp(-de/90.0)*0.7);
    float live=max(diff,ev)*vis;
    trP=max(max(pk,tip)*ln(r.x,1.7),live*ln(r.x,2.4));
    trG=max(max(pk,tip),live*1.6)*exp(-r.x*0.22*Z);
    trL*=pT;
  }
  // Page layout that the diffs patch into the grid.
  float ins=0.0,edg=0.0,rid=-1.0;
  if(p3>0.001){
    R(vec4(0.0,0.0,1.0,0.09),cc,css,0.0,ins,edg,rid);
    R(vec4(0.0,0.14,0.2,0.86),cc,css,1.0,ins,edg,rid);
    R(vec4(0.25,0.15,0.46,0.09),cc,css,2.0,ins,edg,rid);
    R(vec4(0.25,0.29,0.7,0.05),cc,css,3.0,ins,edg,rid);
    R(vec4(0.25,0.37,0.52,0.05),cc,css,4.0,ins,edg,rid);
    R(vec4(0.25,0.5,0.33,0.5),cc,css,5.0,ins,edg,rid);
    R(vec4(0.62,0.5,0.38,0.5),cc,css,6.0,ins,edg,rid);
  }
  float rad=grow*(size.x+size.y);
  vec2 dp=abs(cc-u_tb);float since=rad-(dp.x+dp.y);
  float rev=step(0.0,since);float flash=rev*exp(-max(since,0.0)/110.0);
  vec2 de2=abs(css-u_tb);float erev=step(de2.x+de2.y,rad);
  float card=step(5.5,rid);
  // Patch flash sweeps across the live card from its left edge as the diff lands.
  float sweep=0.0;
  if(card>0.5){float x0=floor((u_panel.x+0.62*u_panel.z)/C+0.5)*C;float k=(cc.x-x0)/max(1.0,0.38*u_panel.z);
    sweep=u_patch*smoothstep(0.35,0.0,abs(k-(1.0-u_patch)*1.2));}
  float fill=ins*rev*insq*(0.08+0.5*flash+card*(0.05+0.35*u_patch+0.45*sweep))*p3;
  float edgeA=edg*erev*p3*(0.7+0.3*card*(1.0+u_patch));
  float ph2=u_time*0.5+h2(gi)*20.0;
  float fl=step(0.975,h2(gi+floor(ph2)*1.37))*pow(1.0-fract(ph2),2.0)*amb*insq*(1.0-ins);
  vec3 sig=u_acc;
  vec3 col=u_bg;
  float gA=mix(0.06,0.12,major)+near*0.3+ring*0.55*amb;
  col=mix(col,mix(u_ink,u_acc,clamp(near*1.6+ring*2.0*amb,0.0,1.0)),gridL*clamp(gA,0.0,1.0));
  col=mix(col,u_acc,fl*0.16);
  col=mix(col,u_acc,clamp(fill,0.0,1.0));
  col=mix(col,u_acc,clamp((sH+sV)*amb+edgeA,0.0,1.0));
  col=mix(col,sig,clamp(inW+trL*mix(0.5,0.35,p3)+trP,0.0,1.0));
  col=mix(col,sig,clamp(nFill+nRing+shock,0.0,1.0));
  // Additive glow only reads on the Void; on the Lab the packets carry by colour alone.
  col+=(u_acc*(hH+hV)*amb*0.1+sig*(halo*0.18+trG*0.26))*(1.0-u_light);
  col=mix(col,sig,clamp(trG*0.35*u_light,0.0,1.0));
  vec2 uv=gl_FragCoord.xy/u_res;
  float vg=smoothstep(1.25,0.4,length((uv-0.5)*vec2(1.3,1.0)));
  col=mix(u_bg,col,mix(0.55,1.0,max(vg,p3*ins)));
  gl_FragColor=vec4(mix(col,u_bg,u_out),1.0);
}`
