'use strict';
/**
 * The 256 words a recovery phrase is drawn from.
 *
 * Twelve of these, chosen at random, is 96 bits — far beyond guessing, and
 * short enough to write on a piece of paper without mistakes. They were
 * picked to be easy to write down and hard to confuse: three to six letters,
 * no plurals, nothing that sounds like anything else on the list (no
 * bear/bare, no flour/flower), and no word that could alarm anybody finding
 * the paper.
 *
 * This list must never change. A phrase written down in 2026 has to still
 * open the vault in 2046, so words may not be added, removed or reordered.
 */
const RECOVERY_WORDS = [
  'acorn', 'amber', 'anchor', 'anvil', 'apple', 'apron', 'arrow', 'ash',
  'aspen', 'attic', 'axle', 'bacon', 'badger', 'bamboo', 'banjo', 'barley',
  'barn', 'basin', 'basket', 'beacon', 'beetle', 'bellow', 'bench', 'birch',
  'biscuit', 'blanket', 'bolt', 'bonnet', 'boot', 'bottle', 'boulder', 'bracket',
  'bramble', 'brass', 'bridge', 'bridle', 'broom', 'bucket', 'buckle', 'burrow',
  'button', 'cabbage', 'cabin', 'cable', 'cactus', 'camel', 'candle', 'canvas',
  'carrot', 'cart', 'castle', 'cattle', 'cedar', 'chain', 'chalk', 'cheese',
  'cherry', 'chest', 'chimney', 'chisel', 'cider', 'cinder', 'clamp', 'clay',
  'cliff', 'clock', 'clover', 'coal', 'cobweb', 'cocoa', 'collar', 'comet',
  'compass', 'copper', 'coral', 'cork', 'cotton', 'crate', 'crayon', 'cricket',
  'crumb', 'crystal', 'cudgel', 'cupboard', 'curtain', 'cushion', 'dagger', 'daisy',
  'dew', 'damson', 'desk', 'dial', 'diamond', 'ditch', 'dock', 'donkey',
  'drum', 'duckweed', 'dune', 'dynamo', 'eagle', 'ember', 'engine', 'envelope',
  'fabric', 'falcon', 'fathom', 'feather', 'fennel', 'fern', 'ferry', 'fiddle',
  'filter', 'flagon', 'flannel', 'flask', 'flint', 'forge', 'fossil', 'fountain',
  'fox', 'frost', 'funnel', 'furnace', 'gable', 'galley', 'garden', 'garlic',
  'gasket', 'gate', 'gavel', 'ginger', 'glacier', 'glove', 'granite', 'gravel',
  'grotto', 'gully', 'gutter', 'hammer', 'hamper', 'harbour', 'harp', 'harvest',
  'hatchet', 'hazel', 'heather', 'hedge', 'helmet', 'hinge', 'hollow', 'honey',
  'hoof', 'hopper', 'hornet', 'hurdle', 'igloo', 'index', 'ingot', 'inlet',
  'iris', 'ivy', 'jacket', 'jar', 'jasmine', 'jetty', 'jigsaw', 'juniper',
  'kennel', 'kettle', 'keyhole', 'kiln', 'kingfisher', 'kipper', 'kite', 'ladder',
  'ladle', 'lagoon', 'lantern', 'larch', 'lattice', 'lawn', 'ledge', 'lemon',
  'lentil', 'lever', 'lichen', 'lilac', 'linen', 'lintel', 'lobster', 'locket',
  'lupin', 'magnet', 'mallet', 'mango', 'mantle', 'marble', 'marrow', 'mast',
  'meadow', 'medal', 'melon', 'mercury', 'mineral', 'mitten', 'mortar', 'mosaic',
  'moss', 'mulberry', 'mushroom', 'mussel', 'nectar', 'needle', 'nettle', 'nickel',
  'nutmeg', 'oatcake', 'obsidian', 'octopus', 'olive', 'onion', 'opal', 'orchard',
  'otter', 'oven', 'oxide', 'paddle', 'pagoda', 'palace', 'pancake', 'pantry',
  'parcel', 'parsnip', 'pasture', 'peach', 'pebble', 'pelican', 'pepper', 'pewter',
  'pigment', 'pillar', 'pincer', 'pipe', 'piston', 'pitcher', 'plank', 'platform',
  'plum', 'pocket', 'pollen', 'pottery', 'prism', 'pulley', 'pumpkin', 'purse',
];

module.exports = { RECOVERY_WORDS };
