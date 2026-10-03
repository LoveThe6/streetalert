FAULT PICTURES
==============
Every fault type and category has a picture slot:

  public/img/faults/<fault_type>.jpg   <- put a REAL PHOTO here (optional)
  public/img/faults/<fault_type>.svg   <- illustrated fallback (included)
  public/img/cats/<category>.jpg / .svg

If a .jpg exists the app shows it (map pins, menus, lists, details). If not, it shows the .svg.
Use square-ish photos, about 400x400 px, under ~60 KB each. Use photos you own or that are
licensed for reuse (e.g. Unsplash, Pexels, Wikimedia Commons) and credit them in your report.

Fault type file names:
 electricity: cable_stolen pole_down transformer exposed_wires outage streetlight
 water:       burst_pipe leakage no_water sewer open_manhole
 roads:       pothole road_damage traffic_light flooding fallen_tree
 accident:    collision breakdown pedestrian roadblock
 other:       other
Category file names: electricity water roads accident other
