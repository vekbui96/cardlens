import type { RawCard } from "./schema.ts";

/**
 * Deterministic fixtures mirroring the shape of real pokemontcg.io cards (incl.
 * tcgplayer prices with varying finishes). Used by MockPokemonProvider, the
 * DevPanel toggles, unit tests, and Playwright flows.
 *
 * Every set carries its REAL `total` and `printedTotal`. They were absent
 * entirely until the completion tiers went in, and MockPokemonProvider builds
 * its set list out of these embedded set objects — so under mocks no set had a
 * size, and no e2e run had ever rendered a progress bar. Real numbers keep the
 * mock catalog honest and give the tiers something to partition: Base is
 * 102/102 and has one tier, while `sv3-223` and `swsh7-215` are both past their
 * printed totals and are over-number cards.
 */
export const MOCK_CARDS: RawCard[] = [
  {
    id: "sv3-223",
    name: "Charizard ex",
    supertype: "Pokémon",
    subtypes: ["Stage 2", "ex"],
    number: "223",
    artist: "PLANETA Mochizuki",
    rarity: "Special Illustration Rare",
    nationalPokedexNumbers: [6],
    set: {
      id: "sv3",
      name: "Obsidian Flames",
      series: "Scarlet & Violet",
      releaseDate: "2023/08/11",
      ptcgoCode: "OBF",
      total: 230,
      printedTotal: 197,
    },
    images: {
      small: "https://images.pokemontcg.io/sv3/223.png",
      large: "https://images.pokemontcg.io/sv3/223_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/sv3-223",
      updatedAt: "2026/07/11",
      prices: {
        holofoil: { low: 49.99, mid: 61.25, high: 120.0, market: 58.42, directLow: 55.0 },
      },
    },
  },
  {
    id: "sv3-125",
    name: "Charizard ex",
    supertype: "Pokémon",
    subtypes: ["Stage 2", "ex"],
    number: "125",
    artist: "5ban Graphics",
    rarity: "Double Rare",
    nationalPokedexNumbers: [6],
    set: {
      id: "sv3",
      name: "Obsidian Flames",
      series: "Scarlet & Violet",
      releaseDate: "2023/08/11",
      ptcgoCode: "OBF",
      total: 230,
      printedTotal: 197,
    },
    images: {
      small: "https://images.pokemontcg.io/sv3/125.png",
      large: "https://images.pokemontcg.io/sv3/125_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/sv3-125",
      updatedAt: "2026/07/10",
      prices: {
        holofoil: { low: 6.5, mid: 9.75, high: 40.0, market: 8.11, directLow: 7.2 },
      },
    },
  },
  {
    id: "base1-4",
    name: "Charizard",
    supertype: "Pokémon",
    subtypes: ["Stage 2"],
    number: "4",
    artist: "Mitsuhiro Arita",
    rarity: "Rare Holo",
    nationalPokedexNumbers: [6],
    // 102/102: no secrets, so Base has a single completion tier.
    set: {
      id: "base1",
      name: "Base",
      series: "Base",
      releaseDate: "1999/01/09",
      ptcgoCode: "BS",
      total: 102,
      printedTotal: 102,
    },
    images: {
      small: "https://images.pokemontcg.io/base1/4.png",
      large: "https://images.pokemontcg.io/base1/4_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/base1-4",
      updatedAt: "2026/07/09",
      prices: {
        holofoil: { low: 220.0, mid: 350.0, high: 3000.0, market: 289.99, directLow: null },
        reverseHolofoil: { low: null, mid: null, high: null, market: null, directLow: null },
      },
    },
  },
  {
    id: "swsh1-25",
    name: "Charizard V",
    supertype: "Pokémon",
    subtypes: ["Basic", "V"],
    number: "25",
    artist: "aky CG Works",
    rarity: "Rare Holo V",
    nationalPokedexNumbers: [6],
    set: {
      id: "swsh1",
      name: "Champion's Path",
      series: "Sword & Shield",
      releaseDate: "2020/09/25",
      ptcgoCode: "CPA",
      total: 80,
      printedTotal: 73,
    },
    images: {
      small: "https://images.pokemontcg.io/swsh45sv/SV107.png",
      large: "https://images.pokemontcg.io/swsh45sv/SV107_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/swsh1-25",
      updatedAt: "2026/07/11",
      prices: {
        normal: { low: 3.0, mid: 5.0, high: 20.0, market: 4.25, directLow: 3.9 },
        holofoil: { low: 8.0, mid: 12.0, high: 55.0, market: 10.5, directLow: 9.4 },
      },
    },
  },
  {
    id: "swsh3-20",
    name: "Charizard VMAX",
    supertype: "Pokémon",
    subtypes: ["VMAX"],
    number: "20",
    artist: "aky CG Works",
    rarity: "Rare Holo VMAX",
    nationalPokedexNumbers: [6],
    set: {
      id: "swsh3",
      name: "Darkness Ablaze",
      series: "Sword & Shield",
      releaseDate: "2020/08/14",
      ptcgoCode: "DAA",
      total: 201,
      printedTotal: 189,
    },
    images: {
      small: "https://images.pokemontcg.io/swsh3/20.png",
      large: "https://images.pokemontcg.io/swsh3/20_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/swsh3-20",
      updatedAt: "2026/07/11",
      prices: {
        holofoil: { low: 18.0, mid: 28.0, high: 90.0, market: 24.75, directLow: 21.0 },
      },
    },
  },
  {
    id: "base1-58",
    name: "Pikachu",
    supertype: "Pokémon",
    subtypes: ["Basic"],
    number: "58",
    artist: "Mitsuhiro Arita",
    rarity: "Common",
    nationalPokedexNumbers: [25],
    // 102/102: no secrets, so Base has a single completion tier.
    set: {
      id: "base1",
      name: "Base",
      series: "Base",
      releaseDate: "1999/01/09",
      ptcgoCode: "BS",
      total: 102,
      printedTotal: 102,
    },
    images: {
      small: "https://images.pokemontcg.io/base1/58.png",
      large: "https://images.pokemontcg.io/base1/58_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/base1-58",
      updatedAt: "2026/07/08",
      prices: {
        normal: { low: 1.5, mid: 4.0, high: 30.0, market: 3.1, directLow: 2.5 },
      },
    },
  },
  {
    id: "swsh7-215",
    name: "Umbreon VMAX",
    supertype: "Pokémon",
    subtypes: ["VMAX"],
    number: "215",
    artist: "Studio Bora Inc.",
    rarity: "Secret Rare",
    nationalPokedexNumbers: [197],
    set: {
      id: "swsh7",
      name: "Evolving Skies",
      series: "Sword & Shield",
      releaseDate: "2021/08/27",
      ptcgoCode: "EVS",
      // 215 is past the printed 203, so this card is over-number: it counts
      // toward master and never toward base.
      total: 237,
      printedTotal: 203,
    },
    images: {
      small: "https://images.pokemontcg.io/swsh7/215.png",
      large: "https://images.pokemontcg.io/swsh7/215_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/swsh7-215",
      updatedAt: "2026/07/11",
      prices: {
        holofoil: { low: 380.0, mid: 480.0, high: 900.0, market: 429.99, directLow: 410.0 },
      },
    },
  },
  {
    id: "sv2-106",
    name: "Greninja ex",
    supertype: "Pokémon",
    subtypes: ["Stage 2", "ex"],
    number: "106",
    artist: "PLANETA Mochizuki",
    rarity: "Double Rare",
    nationalPokedexNumbers: [658],
    set: {
      id: "sv2",
      name: "Paldea Evolved",
      series: "Scarlet & Violet",
      releaseDate: "2023/06/09",
      ptcgoCode: "PAL",
      total: 279,
      printedTotal: 193,
    },
    images: {
      small: "https://images.pokemontcg.io/sv2/106.png",
      large: "https://images.pokemontcg.io/sv2/106_hires.png",
    },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/sv2-106",
      updatedAt: "2026/07/10",
      prices: {
        holofoil: { low: 2.0, mid: 4.5, high: 25.0, market: 3.75, directLow: 3.1 },
      },
    },
  },
];

/** Popular Pokémon offered as no-typing search shortcuts on the home screen. */
export const POPULAR_POKEMON = [
  "Charizard",
  "Pikachu",
  "Umbreon",
  "Greninja",
  "Mewtwo",
  "Gengar",
  "Rayquaza",
  "Lucario",
] as const;
