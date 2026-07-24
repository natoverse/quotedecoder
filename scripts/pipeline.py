"""Shared filtering + tagging pipeline for the quote corpus.

Single source of truth used by build scripts:
  - political / religious filtering (keeps quotes neutral, informative, inspiring)
  - tag assignment (category -> tags array, plus content-derived tags)
"""
import json, re

SRC = "quotes.json"

# ---------------- Filters (political + religious) ----------------
POLITICAL = [
 "donald trump","melania trump","ivanka trump","donald trump jr","eric trump","donald j. trump",
 "joe biden","hunter biden","jill biden","joseph biden","kamala harris","mike pence",
 "barack obama","michelle obama","hillary clinton","bill clinton","hillary rodham clinton",
 "william j. clinton","william jefferson clinton","nancy pelosi","mitch mcconnell","ted cruz",
 "bernie sanders","elizabeth warren","ron desantis","marjorie taylor greene","alexandria ocasio-cortez",
 "vladimir putin","boris johnson","nigel farage","chuck schumer","lindsey graham","josh hawley",
 "marco rubio","rand paul","newt gingrich","sarah palin","vivek ramaswamy","mike pompeo",
 "rudy giuliani","steve bannon","tucker carlson","volodymyr zelensky","zelenskyy",
]

def is_political(q):
    a = q["author"].lower(); t = q["quote"].lower()
    return any(n in a or n in t for n in POLITICAL)

RELIG_CATS = {"god", "religion"}
_RELIG_TOKENS = [
 r"god",r"gods",r"godly",r"jesus",r"christ",r"christian",r"christianity",r"christ's",
 r"messiah",r"almighty",r"gospel",r"gospels",r"scripture",r"scriptures",r"biblical",r"bible",
 r"worship",r"prayer",r"prayers",r"prayed",r"praying",r"sermon",r"sabbath",r"hallelujah",
 r"amen",r"psalm",r"psalms",r"commandment",r"commandments",r"salvation",r"savior",r"saviour",
 r"redeemer",r"resurrection",r"crucified",r"crucifixion",r"prophet",r"prophets",r"disciple",
 r"disciples",r"apostle",r"apostles",r"heaven",r"heavenly",r"holy spirit",r"holy ghost",
 r"holy bible",r"kingdom of god",r"kingdom of heaven",r"word of god",r"will of god",
 r"love of god",r"grace of god",r"the lord",r"lord god",r"praise the lord",r"our lord",r"thy god",
]
_relig_re = re.compile(r"\b(" + "|".join(_RELIG_TOKENS) + r")\b", re.IGNORECASE)

def is_religious(q):
    return q["category"] in RELIG_CATS or bool(_relig_re.search(q["quote"]))

# ---------------- Tagging ----------------
TAG_KEYWORDS = {
 "family": ["family", "families", "relatives", "household"],
 "kids": ["kid", "kids", "child", "children", "childhood", "son", "daughter", "baby", "babies", "toddler"],
 "parenting": ["parent", "parents", "parenting", "raising children", "upbringing"],
 "mother": ["mother", "mothers", "mom", "mommy", "maternal"],
 "father": ["father", "fathers", "dad", "daddy", "paternal"],
 "marriage": ["marriage", "married", "marry", "wife", "husband", "spouse", "wedding"],
 "love": ["love", "loving", "beloved", "affection"],
 "romance": ["romance", "romantic", "passion", "kiss"],
 "friendship": ["friend", "friends", "friendship", "companion"],
 "work": ["work", "working", "job", "career", "labor", "workplace"],
 "success": ["success", "successful", "achieve", "achievement", "accomplish", "triumph"],
 "failure": ["failure", "fail", "failed", "defeat"],
 "money": ["money", "wealth", "rich", "riches", "fortune", "cash", "finance", "financial"],
 "business": ["business", "company", "entrepreneur", "customer", "market", "corporate", "startup"],
 "leadership": ["leader", "leaders", "leadership"],
 "education": ["education", "school", "teacher", "teaching", "student", "classroom", "university", "college"],
 "learning": ["learn", "learning", "learned", "study", "studying"],
 "knowledge": ["knowledge", "understanding", "insight"],
 "wisdom": ["wisdom", "wise"],
 "time": ["time", "moment", "hour", "minute"],
 "happiness": ["happy", "happiness", "joy", "joyful", "delight", "cheerful"],
 "hope": ["hope", "hopeful", "optimism", "optimistic"],
 "courage": ["courage", "brave", "bravery", "fearless", "bold"],
 "fear": ["fear", "afraid", "scared", "frightened"],
 "change": ["change", "changing", "transform", "transformation"],
 "dreams": ["dream", "dreams", "dreaming", "aspiration"],
 "future": ["future", "destiny"],
 "health": ["health", "healthy", "wellness", "disease", "illness"],
 "fitness": ["fitness", "exercise", "workout", "gym", "muscle"],
 "food": ["food", "eat", "eating", "meal", "cooking", "cuisine", "hunger"],
 "nature": ["nature", "earth", "tree", "trees", "flower", "flowers", "ocean", "mountain", "river", "forest"],
 "science": ["science", "scientific", "scientist", "physics", "biology", "chemistry", "experiment"],
 "technology": ["technology", "computer", "computers", "internet", "digital", "software", "machine", "robot"],
 "art": ["art", "artist", "painting", "sculpture", "canvas"],
 "music": ["music", "song", "songs", "musician", "melody", "rhythm", "singing"],
 "books": ["book", "books", "reading", "novel", "literature"],
 "writing": ["writing", "writer", "poet", "poetry", "poem"],
 "travel": ["travel", "journey", "voyage", "adventure", "explore"],
 "sports": ["sport", "sports", "athlete", "football", "baseball", "basketball"],
 "death": ["death", "die", "dying", "dead", "mortality", "grave"],
 "life": ["life", "living", "alive", "existence"],
 "truth": ["truth", "honesty", "honest"],
 "freedom": ["freedom", "liberty", "independence"],
 "peace": ["peace", "peaceful", "tranquility"],
 "war": ["war", "battle", "soldier", "army", "combat", "weapon"],
 "humor": ["humor", "funny", "laugh", "laughter", "joke", "comedy"],
 "beauty": ["beauty", "beautiful", "gorgeous", "lovely"],
 "strength": ["strength", "strong"],
 "power": ["power", "powerful"],
 "patience": ["patience", "patient"],
 "trust": ["trust", "trustworthy"],
 "respect": ["respect", "dignity", "honor"],
 "gratitude": ["gratitude", "grateful", "thankful", "thanks", "appreciate"],
 "kindness": ["kind", "kindness", "compassion", "generous", "generosity"],
 "anger": ["anger", "angry", "rage", "fury"],
 "sadness": ["sad", "sadness", "sorrow", "grief", "tears"],
 "loneliness": ["lonely", "loneliness", "alone", "solitude"],
 "motivation": ["motivation", "motivated", "determination", "perseverance", "persistence"],
 "inspiration": ["inspire", "inspiration", "inspiring", "inspired"],
 "imagination": ["imagination", "imagine"],
 "creativity": ["creativity", "creative"],
 "history": ["history", "historical", "ancient"],
 "home": ["home", "house"],
}

# Normalize some raw source categories to cleaner tag names.
CATEGORY_ALIAS = {
    "dad": "father", "mom": "mother", "mothersday": "mother", "fathersday": "father",
    "funny": "humor", "motivational": "motivation", "inspirational": "inspiration",
    "positive": "positivity", "relationship": "relationships", "computers": "technology",
    "finance": "money", "teen": "youth", "alone": "loneliness", "movingon": "moving-on",
}

_compiled = {t: re.compile(r"\b(" + "|".join(kw) + r")\b", re.IGNORECASE) for t, kw in TAG_KEYWORDS.items()}


def compute_tags(cat, text):
    base = CATEGORY_ALIAS.get(cat, cat)
    tags = [base] if base else []
    for t, rx in _compiled.items():
        if t != base and rx.search(text):
            tags.append(t)
    seen = set(); out = []
    for t in tags:
        if t not in seen:
            seen.add(t); out.append(t)
    return out or ["general"]


def load_tagged_quotes(src=SRC):
    """Return the filtered, tagged quote set in canonical (source) order.

    Each item: {"quote": str, "author": str, "tags": [str, ...]}.
    """
    with open(src) as f:
        data = json.load(f)
    out = []
    for q in data:
        if is_political(q) or is_religious(q):
            continue
        out.append({
            "quote": q["quote"],
            "author": q["author"],
            "tags": compute_tags(q.get("category", ""), q["quote"]),
        })
    return out
