const ink = '#524d3b'
const ground = '#e8e0bf'
const villageColors = ['#976048','#65785a','#b27a4b','#537470','#797291','#856144','#527997','#957050']
const tau = Math.PI * 2

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function polygon(c, points, fill, stroke = ink, width = 1.3) {
  c.beginPath()
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y))
  c.closePath()
  if (fill) { c.fillStyle = fill; c.fill() }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke() }
}

function line(c, path, color, width = 1.1) {
  c.strokeStyle = color
  c.lineWidth = width
  c.stroke(new Path2D(path))
}

function ellipse(c, x, y, rx, ry, fill, stroke, width = 1) {
  c.beginPath()
  c.ellipse(x,y,rx,ry,0,0,tau)
  if (fill) { c.fillStyle=fill; c.fill() }
  if (stroke) { c.lineWidth=width; c.strokeStyle=stroke; c.stroke() }
}

// Small timber buildings have a visible gable, an eave and weathered shingles.
function house(c,x,y,s,roof, mirror=false) {
  c.save()
  c.translate(x,y)
  c.scale(mirror ? -s : s,s)
  ellipse(c,5,1,30,6,'#635d4133')
  polygon(c,[[-21,-21],[10,-26],[10,-2],[-21,2]],'#ead6a9')
  polygon(c,[[10,-26],[20,-41],[30,-26],[30,-7],[10,-2]],'#c9b68e')
  polygon(c,[[-26,-20],[-15,-41],[20,-46],[9,-24]],roof)
  polygon(c,[[9,-24],[20,-46],[33,-27],[30,-25],[20,-39],[12,-23]],roof)
  line(c,'M-22 -19 L8 -23 M-17 -9 L8 -13 M-13 -20 L-13 0 M6 -22 L6 -3 M13 -4 L13 -23 M28 -8 L28 -25',ink)
  line(c,'M-19 -30 L12 -35 M-9 -39 l-3 5 M2 -36 l-3 5 M-15 -28 l-3 6 M6 -31 l-3 5','#695b48',0.8)
  polygon(c,[[-6,0],[-6,-13],[0,-14],[0,-1]],'#6e5940')
  polygon(c,[[18,-21],[23,-22],[23,-15],[18,-14]],'#675b47')
  c.restore()
}

function tree(c,x,y,s,pine,rand) {
  c.save()
  c.translate(x,y); c.scale(s,s)
  ellipse(c,4,0,12,3.5,'#706d4829')
  line(c,'M-1 0 L0 -18 M0 -4 L5 -11','#5f5942',2.4)
  const tones=['#878e66','#90946c','#a0a17a','#778460']
  const color=tones[Math.floor(rand()*tones.length)]
  if (pine) {
    polygon(c,[[0,-34],[-6,-23],[-4,-23],[-10,-14],[-6,-15],[-13,-6],[-2,-8],[0,-6],[12,-9],[7,-15],[10,-14],[5,-22],[7,-22]],color,'#60694d',1)
    line(c,'M0 -28 l1 8 3 3 M-1 -18 l-2 6 -4 2 M1 -13 l3 4','#64704f',0.9)
  } else {
    const p=new Path2D('M-11 -8 Q-18 -13 -12 -19 Q-15 -24 -8 -27 Q-7 -34 0 -32 Q6 -35 9 -28 Q17 -27 14 -19 Q19 -13 13 -10 Q10 -4 3 -8 Q-3 -3 -7 -8 Z')
    c.fillStyle=color; c.fill(p); c.strokeStyle='#687051'; c.lineWidth=1; c.stroke(p)
    line(c,'M-9 -13 q3 3 6 0 M1 -9 q6 -1 7 -6 M-3 -25 q4 -4 7 0','#737a58')
  }
  c.restore()
}

function watermill(c,x,y) {
  c.save(); c.translate(x,y)
  const race='M125 -56 C85 -50 44 -42 29 -20 S31 11 55 19 S100 28 136 63'
  line(c,race,'#9ca387',13); line(c,race,'#aec9ba',10)
  house(c,0,-1,1.1,'#9b7858')
  c.translate(31,-10)
  ellipse(c,0,0,10.5,16,'#a1845b',ink,1.4)
  ellipse(c,-3,0,10,16,'#c7b58a',ink,1.3)
  for(let n=0;n<10;n++) {
    const a=n*tau/10
    line(c,`M-3 0 L${-3+10*Math.cos(a)} ${16*Math.sin(a)}`,ink,1.3)
    line(c,`M${-3+10*Math.cos(a)} ${16*Math.sin(a)} l4 0`,ink,1.2)
  }
  ellipse(c,-3,0,2,3,'#65543e')
  c.restore()
}
function fence(c, points) {
  for(let i=1;i<points.length;i++) {
    const [x,y]=points[i-1], [dx,dy]=[points[i][0]-x,points[i][1]-y]
    const steps=Math.ceil(Math.hypot(dx,dy)/14)
    line(c,`M${x} ${y-4} l${dx} ${dy}`,'#85775a',1.3)
    for(let j=0;j<=steps;j++) {
      const px=x+dx*j/steps, py=y+dy*j/steps
      line(c,`M${px} ${py} l-1 -7`,'#817252',1.5)
    }
  }
}

function landscape(c,bounds) {
  const rand=randomGenerator(26111)
  const {left,top,width,height}=bounds
  c.fillStyle=ground; c.fillRect(left,top,width,height)
  c.lineCap='round'; c.lineJoin='round'
  // Irregular translucent washes keep broad open areas readable at any zoom.
  for(let i=0;i<170;i++) {
    const x=left+rand()*width,y=top+rand()*height,r=25+rand()*95
    const g=c.createRadialGradient(x,y,0,x,y,r)
    g.addColorStop(0,i%3===0?'#a9ae7355':'#f7ebc755'); g.addColorStop(1,'#e8e0bf00')
    c.fillStyle=g; c.fillRect(x-r,y-r,r*2,r*2)
  }
  const stream='M847 -450 C798 -240 1008 -98 913 33 S832 162 877 245 S980 332 898 422 S809 514 862 609 S963 714 896 807 S803 949 870 1230'
  line(c,stream,'#929c82',52); line(c,stream,'#d0d7b3',49); line(c,stream,'#a7c4b8',44)
  line(c,'M902 72 Q846 139 864 182 M904 289 Q945 337 914 376 M867 472 Q829 510 849 552 M887 662 Q929 709 917 748','#cddbc6',2)
  const fields=[
    [[[131,112],[211,90],[245,138],[159,170]],'#c4b77e'],
    [[[222,88],[294,68],[332,116],[254,139]],'#cbbd87'],
    [[[165,179],[247,149],[268,186],[184,220]],'#c4b07c'],
    [[[260,148],[338,124],[357,155],[279,184]],'#b9b18a'],
    [[[83,234],[135,208],[162,248],[107,278]],'#c7bc8c'],
    [[[615,104],[676,87],[695,110],[628,131]],'#c9b67c'],
    [[[631,140],[695,118],[706,136],[644,158]],'#b9b383']
  ]
  for(const [points,color] of fields) {
    c.save()
    polygon(c,points,color,'#998b6c')
    c.clip()
    const xs=points.map(p=>p[0]), ys=points.map(p=>p[1])
    for(let x=Math.min(...xs)-60;x<Math.max(...xs)+40;x+=7) {
      const y=Math.min(...ys)-10
      line(c,`M${x} ${y} q22 30 47 88`,'#92865c',1)
      line(c,`M${x+2} ${y} q22 30 47 88`,'#e2d59d',1.3)
    }
    c.restore()
  }
  fence(c,[[132,110],[211,88],[292,66]])
  fence(c,[[165,180],[184,221],[266,189]])
  const roads=[
    'M-350 300 C-90 280 42 350 140 368 S348 359 439 398 Q493 426 536 401 C613 359 653 335 724 329 S880 314 968 333 L1380 272',
    'M240 219 C258 270 334 254 365 304 S395 369 452 395',
    'M511 393 C490 346 454 333 459 306 S526 229 599 208 S691 183 741 166',
    'M462 403 C403 429 416 478 365 508 S298 558 301 589 S287 666 207 715 L48 872',
    'M516 405 C547 442 565 465 602 479 S646 474 670 460',
    'M511 405 C500 478 470 546 489 587 Q495 604 515 645',
    'M107 495 C207 455 294 479 359 503',
    'M504 625 C573 626 609 676 683 699 S827 756 842 843'
  ]
  for(const road of roads) { line(c,road,'#b9a886',10); line(c,road,'#e4ceaa',7.5) }
  polygon(c,[[902,315],[938,317],[937,332],[900,331]],'#ae906b')
  for(let b=903;b<938;b+=5) line(c,`M${b} 317 l-1 13`,'#7d6a4f')
  line(c,'M898 315 l42 2 M898 330 l41 3','#675e48',2)

  for(let i=0;i<2300;i++) {
    const x=left+rand()*width,y=top+rand()*height
    if(x>812 && x<955) continue
    if(i%6===0) {
      line(c,`M${x} ${y} l-2 -2 m2 2 l1 -3 m3 3 l2 -2`,'#93956870',0.9)
    } else ellipse(c,x,y,0.4+rand()*0.7,0.5,'#837b5240')
  }
  const scenery=[]
  function grove(cx,cy,rx,ry,count,pine) {
    for(let i=0;i<count;i++) {
      const a=rand()*tau,r=Math.sqrt(rand()),x=cx+Math.cos(a)*r*rx,y=cy+Math.sin(a)*r*ry
      const s=0.65+rand()*0.65
      scenery.push([y,()=>tree(c,x,y,s,pine,rand)])
    }
  }
  grove(70,487,78,67,46,true); grove(93,417,55,43,22,true)
  grove(469,70,53,25,12,false); grove(569,74,65,32,13,true)
  grove(787,480,37,67,15,false); grove(707,716,85,28,19,true)
  grove(114,698,84,35,17,false); grove(37,53,76,32,15,true)
  grove(972,104,45,58,22,true); grove(998,622,60,65,25,true)
  const homes=[
    [316,540,.78,'#a57456'],[268,560,.84,'#a88c5d',true],[342,577,.92,'#aa7352'],
    [255,605,.82,'#90907a'],[337,634,.74,'#9c8259',true],[385,571,.69,'#b19769'],
    [598,450,.78,'#a17c58'],[688,449,1.03,'#a96e50',true],[705,491,.68,'#a78b60'],
    [404,315,.66,'#a78966'],[519,299,.72,'#98927a',true],[665,202,.74,'#a78460'],
    [524,625,1.42,'#8e7459'],[559,635,.86,'#927b5d',true]
  ]
  for(const [x,y,s,r,m] of homes) scenery.push([y,()=>house(c,x,y,s,r,m)])
  scenery.push([171,()=>watermill(c,737,171)])
  scenery.push([320,()=>{
    ellipse(c,458,319,11,5,'#beae8c',ink); line(c,'M447 318 v-7 M469 318 v-7',ink)
    ellipse(c,458,312,11,4,'#b4a98a',ink); ellipse(c,458,312,7,2,'#737663')
    line(c,'M450 310 v-15 M466 311 v-16 M448 295 h20 M458 296 v14','#6d6049',2)
  }])
  scenery.push([473,()=>{
    ellipse(c,652,468,13,7,'#c2946e',ink)
    polygon(c,[[641,468],[639,465],[642,455],[647,451],[648,446],[652,446],[652,452],[659,455],[663,463],[662,468]],'#b98964')
    ellipse(c,652,465,5,4,'#655840')
  }])
  fence(c,[[255,619],[282,630],[297,625]])
  fence(c,[[369,603],[398,592],[409,575]])
  fence(c,[[559,645],[578,639],[583,619]])
  scenery.sort((a,b)=>a[0]-b[0]).forEach(item=>item[1]())

  const sites=[
    [238,248,'Strip fields'],[739,202,'Watermill'],[136,542,'Coppice'],
    [323,662,'Cottages'],[456,345,'Village well'],[504,436,'Village green'],
    [677,514,'Common oven'],[523,680,'Village hall']
  ]
  c.textAlign='center'; c.textBaseline='middle'
  for(const [x,y,name] of sites) {
    c.font='italic 18px Georgia, serif'
    c.lineWidth=4; c.strokeStyle='#e8e0bfe8'; c.strokeText(name,x,y)
    c.fillStyle='#474636'; c.fillText(name,x,y)
  }
}

export function createMap(canvas,onSelect) {
  const c=canvas.getContext('2d')
  const paper=document.createElement('canvas')
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)')
  let actors=[], selectedId=null, frame=0, scale=1, left=0, top=0, w=0, h=0, dpr=1
  const stage = canvas.parentElement
  const positions=new Map()
  let hits=[]

  function paint(time) {
    frame=0
    c.setTransform(dpr,0,0,dpr,0,0)
    c.drawImage(paper,0,0,w,h)
    hits=[]
    let moving=false
    const crowd=new Map()
    const markers=[]
    for(const [index,actor] of actors.entries()) {
      const p=positions.get(actor.id)
      const t=reduced.matches ? 1 : Math.min(1,(time-p.time)/650)
      const blend=t*t*(3-2*t)
      p.x=p.startX+(p.endX-p.startX)*blend
      p.y=p.startY+(p.endY-p.startY)*blend
      moving ||= t<1
      const key=Math.round(p.x*2)+','+Math.round(p.y*2)
      const count=crowd.get(key)||0
      crowd.set(key,count+1)
      const a=count*2.4, spread=count ? 11*Math.sqrt(count) : 0
      const x=left+p.x*10*scale+Math.cos(a)*spread, y=top+p.y*10*scale+Math.sin(a)*spread
      markers.push({actor,index,x,y})
    }
    markers.sort((a,b)=>Number(a.actor.id===selectedId)-Number(b.actor.id===selectedId))
    for(const {actor,index,x,y} of markers) {
      const r=Math.max(4.4, Math.min(7.5,7.5*scale))
      if(actor.id===selectedId) {
        ellipse(c,x,y,r+4,r+4,'#f3e4b1bb','#594e38',1.35)
      }
      ellipse(c,x,y+1,r+1,r+1,'#483d3445')
      ellipse(c,x,y,r,r,actor.color||villageColors[index%villageColors.length],'#fff5d9',1.8)
      ellipse(c,x,y,r+1,r+1,null,'#5d5341',0.85)
      hits.push({id:actor.id,name:actor.name,x,y})
    }
    if(moving) frame=requestAnimationFrame(paint)
  }
  function schedule() {
    if(!frame) frame=requestAnimationFrame(paint)
  }
  function resize() {
    const rect=canvas.getBoundingClientRect()
    w=rect.width||stage.clientWidth||700
    h=rect.height||stage.clientHeight||560
    dpr=Math.min(2,window.devicePixelRatio||1)
    canvas.width=paper.width=Math.max(1,Math.round(w*dpr))
    canvas.height=paper.height=Math.max(1,Math.round(h*dpr))
    scale=Math.min(w/1000,h/800)
    left=(w-1000*scale)/2; top=(h-800*scale)/2
    const bg=paper.getContext('2d')
    bg.setTransform(dpr*scale,0,0,dpr*scale,left*dpr,top*dpr)
    landscape(bg,{left:-left/scale,top:-top/scale,width:w/scale,height:h/scale})
    schedule()
  }
  function nearest(event) {
    const rect=canvas.getBoundingClientRect()
    const x=event.clientX-rect.left,y=event.clientY-rect.top
    let best=null, min=event.pointerType==='touch'?22:15
    for(const hit of hits) {
      const dist=Math.hypot(x-hit.x,y-hit.y)
      if(dist<=min) { best=hit; min=dist }
    }
    return best
  }
  function click(e) { const hit=nearest(e); if(hit) onSelect?.(hit.id) }
  function hover(e) {
    const hit=nearest(e)
    canvas.style.cursor=hit?'pointer':'default'
    canvas.title=hit?.name||''
  }
  canvas.style.width='100%'; canvas.style.height='100%'; canvas.style.display='block'
  canvas.addEventListener('click',click)
  canvas.addEventListener('pointermove',hover)
  const observer=new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  return {
    update(rows,id) {
      const now=performance.now(), live=new Set()
      actors=(rows||[]).filter(actor=>{
        const pos=actor.position||actor
        if(!Number.isFinite(pos.x)||!Number.isFinite(pos.y)) return false
        live.add(actor.id)
        const p=positions.get(actor.id)
        if(!p) positions.set(actor.id,{x:pos.x,y:pos.y,startX:pos.x,startY:pos.y,endX:pos.x,endY:pos.y,time:now})
        else if(p.endX!==pos.x||p.endY!==pos.y) Object.assign(p,{startX:p.x,startY:p.y,endX:pos.x,endY:pos.y,time:now})
        return true
      })
      for(const key of positions.keys()) if(!live.has(key)) positions.delete(key)
      selectedId=id; schedule()
    },
    destroy() {
      observer.disconnect(); cancelAnimationFrame(frame)
      canvas.removeEventListener('click',click); canvas.removeEventListener('pointermove',hover)
    }
  }
}
