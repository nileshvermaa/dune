import * as P from './props.js';
import { LANE_W, LANES, HALF_W, shuffle } from './layout.js';

// The obstacles the trail lays across the runner's path, keyed by the ids a zone lists in its
// `weights` (content/zones.js).
//
// To add an obstacle:
//   1. add an entry with place(ctx): build its meshes into seg.group, add colliders with
//      track.addCollider(), and return the way past it (below);
//   2. if it moves, push { type: '<id>', ... } onto seg.animated and give the entry
//      animate(a, time, dt) — Track.update calls it every frame;
//   3. give it a weight in the zones it belongs to (content/zones.js);
//   4. if touching it should do more than stumble or crash the runner, handle its collider
//      `kind` in collide() (game/systems/run.js), as the dust devil does.
// tests/content.test.js checks that every id a zone weights exists here.
//
// place({ track, seg, s, rng, diff }) — s is the distance along the segment, diff the layout
// difficulty 0..1 — returns any of:
//   free     lanes left open (spice is laid along them; default all three)
//   blocked  lanes it fills
//   jump     jumping clears it        slide  sliding under clears it        gap  a sinkhole

// the first 300 m of a run use this gentle mix instead of the zone's own
export const EARLY_MIX = { rock: 3, low: 2, arch: 1 };

// n distinct random lanes, and the lanes left free
function pickLanes(n, rng) {
  const blocked = shuffle([...LANES], rng).slice(0, n);
  return { blocked, free: LANES.filter((l) => !blocked.includes(l)) };
}

// rock spires or ruined columns standing in one or two lanes
function standing(type) {
  return ({ track, seg, s, rng, diff }) => {
    const n = rng() < 0.4 + diff * 0.3 ? 2 : 1;
    const way = pickLanes(n, rng);
    for (const lane of way.blocked) {
      let mesh;
      if (type === 'rock') {
        mesh = P.makeRock('spire', Math.floor(rng() * 4), 0.8, 4.2 + rng() * 2.6, 0.8);
        mesh.position.set(lane * LANE_W, -0.15, -s);
        mesh.rotation.y = rng() * 6.28;
      } else {
        mesh = P.makeColumn(4.5 + rng() * 2.5, rng() < 0.35);
        mesh.scale.setScalar(0.85);
        mesh.position.set(lane * LANE_W, 0, -s);
      }
      seg.group.add(mesh);
      track.addCollider(seg, { kind: type, mesh, s0: s - 0.75, s1: s + 0.75, x0: lane * LANE_W - 0.85, x1: lane * LANE_W + 0.85, y0: 0, y1: 20 });
    }
    return way;
  };
}

export const OBSTACLES = {
  rock: { name: 'Rock spire', place: standing('rock') },
  column: { name: 'Fallen column', place: standing('column') },

  // a tumbled wall: jump it, or run through the breach in it
  low: {
    name: 'Tumbled wall',
    place({ track, seg, s, rng }) {
      const open = Math.floor(rng() * 3) - 1;
      const blocked = LANES.filter((l) => l !== open);
      for (const lane of blocked) {
        const mesh = P.makeRubbleWall(rng);
        mesh.scale.set(0.29, 1, 1);
        mesh.position.set(lane * LANE_W, 0, -s);
        seg.group.add(mesh);
        track.addCollider(seg, { kind: 'low', mesh, s0: s - 0.45, s1: s + 0.45, x0: lane * LANE_W - 1.1, x1: lane * LANE_W + 1.1, y0: 0, y1: 0.95 });
      }
      return { free: [open], blocked, jump: true };
    },
  },

  // a spice pipeline across the whole trail: jump it
  pipe: {
    name: 'Pipeline',
    place({ track, seg, s }) {
      const mesh = P.makePipe();
      mesh.position.z = -s;
      seg.group.add(mesh);
      track.addCollider(seg, { kind: 'pipe', mesh, s0: s - 0.45, s1: s + 0.45, x0: -HALF_W, x1: HALF_W, y0: 0, y1: 0.95 });
      return { jump: true };
    },
  },

  // a standing slab across two lanes: no jumping it, only around
  tall: {
    name: 'Standing slab',
    place({ track, seg, s, rng }) {
      const open = rng() < 0.5 ? -1 : 1;
      const mesh = P.makeRuinWall(rng);
      mesh.scale.set(0.3, 0.55, 0.6);
      mesh.position.set(-open * LANE_W * 0.5, -0.5, -s);
      seg.group.add(mesh);
      const x0 = open < 0 ? -LANE_W * 0.5 : -HALF_W, x1 = open < 0 ? HALF_W : LANE_W * 0.5;
      track.addCollider(seg, { kind: 'tall', mesh, s0: s - 0.5, s1: s + 0.5, x0, x1, y0: 0, y1: 20 });
      return { free: [open], blocked: [0, -open] };
    },
  },

  // a dust devil sweeping back and forth across the trail
  devil: {
    name: 'Dust devil',
    place({ track, seg, s, rng, diff }) {
      const mesh = P.makeDustDevil();
      mesh.position.set(0, 0, -s);
      seg.group.add(mesh);
      const col = track.addCollider(seg, { kind: 'devil', mesh, s0: s - 1.1, s1: s + 1.1, x0: -1, x1: 1, y0: 0, y1: 20 });
      seg.animated.push({ type: 'devil', mesh, col, phase: rng() * 6.28, speed: 1.1 + diff * 0.9 + rng() * 0.4 });
      return {}; // it moves, so no lane is reliably blocked or free: spice may go anywhere
    },
    animate(a, time, dt) {
      const x = Math.sin(time * a.speed + a.phase) * LANE_W * 1.2;
      a.mesh.position.x = x;
      a.mesh.rotation.y += dt * 7;
      a.col.x0 = x - 0.95;
      a.col.x1 = x + 0.95;
    },
  },

  // a fallen lintel or a bone arch: slide under it
  arch: {
    name: 'Arch',
    place({ track, seg, s }) {
      const z = seg.zone.id;
      const mesh = z === 'ruins' || z === 'shieldwall' ? P.makeLintel(false) : z === 'spice' ? P.makeLintel(true) : P.makeBoneArch(true);
      mesh.position.z = -s;
      seg.group.add(mesh);
      track.addCollider(seg, { kind: 'arch', mesh, s0: s - 0.55, s1: s + 0.55, x0: -HALF_W, x1: HALF_W, y0: 1.18, y1: 12 });
      return { slide: true };
    },
  },

  // a sinkhole across the trail: jump it (never placed on old paving; see Track.populate)
  gap: {
    name: 'Sinkhole',
    place({ seg, s, diff }) {
      const len = 4.2 + diff * 0.8;
      seg.gaps.push([s - len / 2, s + len / 2]);
      return { jump: true, gap: true };
    },
  },

  // spice blows in one or two lanes, erupting on a cycle (Track.update runs the cycle)
  geyser: {
    name: 'Spice blow',
    place({ track, seg, s, rng }) {
      const n = rng() < 0.5 ? 2 : 1;
      const way = pickLanes(n, rng);
      for (const lane of way.blocked) {
        const gy = P.makeGeyser();
        seg.mats.push(gy.disc.material);
        gy.group.position.set(lane * LANE_W, 0, -s);
        seg.group.add(gy.group);
        const col = track.addCollider(seg, { kind: 'geyser', mesh: gy.group, s0: s - 0.9, s1: s + 0.9, x0: lane * LANE_W - 0.9, x1: lane * LANE_W + 0.9, y0: 0, y1: 20 });
        col.active = false;
        seg.geysers.push({ ...gy, collider: col, phase: rng() * 3, period: 2.8, lane, s, erupting: false });
      }
      return way;
    },
  },
};
