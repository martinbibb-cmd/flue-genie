// js/data/worcester8000.js

window.WORCESTER_8000 = {
  // figure 34: horizontal terminal positions
  figure34_horizontal: [
    { id: 1, type: "eaves", label: "200mm below eaves (75mm below gutters, pipes, drains)", default_mm: 200, notes: "75mm below gutters/pipes." },
    { id: 2, type: "eaves", label: "Reduced under eaves/gutters if terminal extended 100mm", default_mm: 25, notes: "Can reduce to 25mm if flue is extended 100mm beyond overhang; seal telescopic if external." },
    { id: 3, type: "boundary", label: "300mm to boundary", default_mm: 300, notes: "Unless nuisance." },
    { id: 4, type: "terminal", label: "1,200mm between terminals facing", default_mm: 1200, notes: "" },
    { id: 5, type: "boundary", label: "600mm to surface/boundary facing terminal", default_mm: 600, notes: "Unless nuisance." },
    { id: 6, type: "opening", label: "1,500mm below opening OR 600mm side/above", default_mm: 1500, alt_mm: 600, notes: "Below opening 1500mm; either side/above 600mm." },
    { id: 7, type: "opening", label: "600mm diagonally to opening", default_mm: 600, notes: "If flue is ≥300mm above opening, diagonal does not apply." },
    { id: 8, type: "terminal", label: "1,200mm vertical/horizontal separation", default_mm: 1200, notes: "" },
    { id: 10, type: "corner", label: "300mm to internal/external corner", default_mm: 300, notes: "Also 300mm above ground/floor/roof." },
    { id: 11, type: "opening", label: "300mm around opening/vent/window", default_mm: 300, notes: "" },
    { id: 12, type: "lightwell", label: "600mm in lightwell", default_mm: 600, notes: "Plus 300mm clear either side/below; max 1000mm from top." },
    { id: 15, type: "window_fixed", label: "150mm to fixed unvented", default_mm: 150, notes: "300mm to opening or vented window." },
    { id: 17, type: "terminal", label: "300mm horizontally from terminal on same wall", default_mm: 300, notes: "" },
    { id: 18, type: "terminal", label: "1,500mm vertically from terminal on same wall", default_mm: 1500, notes: "" }
  ],
  // figure 35: plume
  figure35_plume_redirect: [
    { id: 1, type: "plume_opening", label: "300mm to opening, but 1,500mm in direction of plume", default_mm: 300, extra_mm_in_direction: 1500, notes: "Standard telescopic horizontal." },
    { id: 2, type: "boundary", label: "300mm to boundary (plume)", default_mm: 300, notes: "" },
    { id: 4, type: "plume_opening", label: "1,500mm from opening in direction of plume", default_mm: 1500, notes: "" }
  ],
  // figure 35: plume management terminals
  figure35_plume_management: [
    { id: 5, type: "boundary", label: "600mm facing surface/boundary", default_mm: 600, notes: "" },
    { id: 6, type: "opening_other_building", label: "2,000mm to opening in adjacent building", default_mm: 2000, notes: "" },
    { id: 7, type: "boundary", label: "300mm adjacent to boundary", default_mm: 300, notes: "" },
    { id: 9, type: "air_intake", label: "Air intake can be 150mm if exhaust has 300mm", default_mm: 150, notes: "" },
    { id: 10, type: "opening", label: "150mm around opening if exhaust 300mm", default_mm: 150, notes: "" },
    { id: 12, type: "terminal", label: "1,200mm between plume terminals", default_mm: 1200, notes: "Can reduce to 600mm if both plume kits have ≥500mm." }
  ]
};
