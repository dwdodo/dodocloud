// Figma plugin main-thread code.
//
// Reads the user's current selection and extracts:
//   - one or more NAMED title/body/image "sections". A bare layer name
//     ("Title", "Body", "Image") is the default/main section (key ""); a
//     name like "Title: About" or "Image: Menu" belongs to a named section
//     ("about", "menu"), so a single frame can hold several independent
//     title+body+image groups (e.g. a hero section, an About section, a
//     Menu section) instead of just one — see parseNamedSlot below.
//   - zero or more NAMED repeatable item groups (title/body/image per item),
//     whose item COUNT is whatever the marketing team left in the Figma file
//     (they duplicate/delete item layers themselves; this plugin just counts
//     however many are there at conversion time). Matched to the HTML by
//     name the same way — see repeatKeyFromName below.
//
// The extracted data is sent to ui.html, which injects it into a
// user-supplied HTML template. Images are intentionally left as a labelled
// placeholder — actual image files are inserted later in whichever editor
// the HTML ends up in (e.g. Cafe24's detail-page editor).

figma.showUI(__html__, { width: 460, height: 720 });

// Keyword lists used to guess which layer plays which role.
// Matching is: layer name (lowercased) === keyword, or includes keyword.
var TITLE_KEYWORDS = ["title", "headline", "heading", "제목", "타이틀"];
var BODY_KEYWORDS = ["body", "content", "description", "copy", "본문", "내용", "설명", "text"];
var IMAGE_KEYWORDS = ["image", "photo", "picture", "thumbnail", "이미지", "사진", "img"];

// A repeat group layer can be named two ways:
//   - a bare keyword ("Items", "List", "카드", ...) -> key defaults to "items"
//   - "<keyword>: <key>" / "<keyword>-<key>" (e.g. "Repeat: Benefits",
//     "반복: 스텝", "List-steps") -> key is whatever follows the separator
// The key is how a repeat group is matched to an HTML data-figma-repeat="<key>"
// container, so multiple distinct repeat groups can coexist in one template.
var BARE_REPEAT_NAMES = ["items", "item", "list", "카드", "반복", "목록", "리스트"];
var REPEAT_PREFIX_RE = /^(?:repeat|list|반복|목록|리스트)\s*[:\-]\s*(.+)$/i;

function repeatKeyFromName(name) {
  var trimmed = (name || "").trim();
  if (!trimmed) return null;

  var prefixMatch = trimmed.match(REPEAT_PREFIX_RE);
  if (prefixMatch && prefixMatch[1].trim()) {
    return prefixMatch[1].trim().toLowerCase();
  }

  if (BARE_REPEAT_NAMES.indexOf(trimmed.toLowerCase()) !== -1) {
    return "items";
  }

  return null;
}

// Finds every repeat-group container in the tree. Does not descend into a
// container once found, so nested repeat groups aren't supported (and won't
// accidentally be split into more groups).
function findAllRepeatContainers(root) {
  var result = [];
  var seenKeys = {};
  var queue = [root];

  while (queue.length > 0) {
    var node = queue.shift();
    var key = repeatKeyFromName(node.name);

    if (key) {
      if (!seenKeys[key]) {
        seenKeys[key] = true;
        result.push({ key: key, node: node });
      }
      continue;
    }

    if ("children" in node) {
      for (var c = 0; c < node.children.length; c++) {
        queue.push(node.children[c]);
      }
    }
  }

  return result;
}

function findSlotNode(root, keywords, excludeIds) {
  var queue = [root];
  while (queue.length > 0) {
    var node = queue.shift();
    if (excludeIds.indexOf(node.id) !== -1) continue;

    var nameLower = (node.name || "").toLowerCase().trim();
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i];
      if (nameLower === kw || nameLower.indexOf(kw) !== -1) {
        return node;
      }
    }

    if ("children" in node) {
      for (var c = 0; c < node.children.length; c++) {
        queue.push(node.children[c]);
      }
    }
  }
  return null;
}

// Parses a layer name against a role's keyword list (TITLE/BODY/IMAGE),
// the same "bare keyword -> default key, keyword: key -> named key"
// convention used for repeat groups (see repeatKeyFromName). Returns null
// if the name doesn't match the role at all.
function parseNamedSlot(name, keywords) {
  var trimmed = (name || "").trim();
  if (!trimmed) return null;
  var nameLower = trimmed.toLowerCase();

  var matched = false;
  for (var i = 0; i < keywords.length; i++) {
    if (nameLower === keywords[i] || nameLower.indexOf(keywords[i]) !== -1) {
      matched = true;
      break;
    }
  }
  if (!matched) return null;

  var sepMatch = trimmed.match(/[:\-]\s*(.+)$/);
  return sepMatch && sepMatch[1].trim() ? sepMatch[1].trim().toLowerCase() : "";
}

// Finds every layer matching a role's keywords, tagged with its section key
// ("" for the default/main section, otherwise whatever follows "Title: ").
// Does not descend into a match, so one frame doesn't get double-counted.
function findAllNamedSlots(root, keywords, excludeIds) {
  var result = [];
  var queue = [root];

  while (queue.length > 0) {
    var node = queue.shift();
    if (excludeIds.indexOf(node.id) !== -1) continue;

    var key = parseNamedSlot(node.name, keywords);
    if (key !== null) {
      result.push({ key: key, node: node });
      continue;
    }

    if ("children" in node) {
      for (var c = 0; c < node.children.length; c++) {
        queue.push(node.children[c]);
      }
    }
  }

  return result;
}

// Layer names often land on a wrapping FRAME/GROUP rather than the text
// itself (e.g. a "Title" frame that contains an unnamed text layer one
// level in). Falls back to the first text layer found anywhere inside the
// matched node, so naming the wrapper is enough — you don't have to name
// the text layer itself.
function firstTextDescendant(node) {
  if (!node) return null;
  var queue = [node];
  while (queue.length > 0) {
    var current = queue.shift();
    if (current.type === "TEXT") return current;
    if ("children" in current) {
      for (var c = 0; c < current.children.length; c++) {
        queue.push(current.children[c]);
      }
    }
  }
  return null;
}

function resolveTextNode(node) {
  if (!node) return null;
  return node.type === "TEXT" ? node : firstTextDescendant(node);
}

function imageSlotData(imageNode) {
  if (!imageNode) return { present: false, width: 0, height: 0 };
  return {
    present: true,
    width: Math.round(imageNode.width),
    height: Math.round(imageNode.height)
  };
}

// Converts a Figma solid Paint to a CSS color string. Returns null for
// anything that isn't a visible solid fill (gradients, images, hidden
// fills) — the HTML template's own color then applies instead.
function paintToCssColor(paint) {
  if (!paint || paint.type !== "SOLID" || paint.visible === false) return null;
  var r = Math.round(paint.color.r * 255);
  var g = Math.round(paint.color.g * 255);
  var b = Math.round(paint.color.b * 255);
  var a = typeof paint.opacity === "number" ? paint.opacity : 1;
  if (a >= 1) return "rgb(" + r + "," + g + "," + b + ")";
  return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
}

function firstSolidColor(fills) {
  if (!fills) return null;
  for (var i = 0; i < fills.length; i++) {
    var color = paintToCssColor(fills[i]);
    if (color) return color;
  }
  return null;
}

// Splits a text layer into style runs (each run = a stretch of characters
// sharing the same font size + fill color), so mixed-size/mixed-color text
// within a single Figma text layer survives the conversion. Returns null if
// the node isn't a text node or the API call fails for any reason.
function textRuns(textNode) {
  if (!textNode || textNode.type !== "TEXT") return null;
  var segments;
  try {
    segments = textNode.getStyledTextSegments(["fontSize", "fills"]);
  } catch (e) {
    return null;
  }
  return segments.map(function (seg) {
    return {
      text: seg.characters,
      fontSize: typeof seg.fontSize === "number" ? seg.fontSize : null,
      color: firstSolidColor(seg.fills)
    };
  });
}

// Extracts title/body/image for a single item inside a repeat group.
function extractItem(itemNode) {
  if (itemNode.type === "TEXT") {
    return {
      title: itemNode.characters,
      titleRuns: textRuns(itemNode),
      body: "",
      bodyRuns: null,
      image: imageSlotData(null)
    };
  }

  var exclude = [];
  var titleNode = findSlotNode(itemNode, TITLE_KEYWORDS, exclude);
  if (titleNode) exclude.push(titleNode.id);

  var bodyNode = findSlotNode(itemNode, BODY_KEYWORDS, exclude);
  if (bodyNode) exclude.push(bodyNode.id);

  var imageNode = findSlotNode(itemNode, IMAGE_KEYWORDS, exclude);

  // If nothing matched at all, assume the whole item IS the image
  // (e.g. a plain photo tile with no text inside it).
  if (!titleNode && !bodyNode && !imageNode) {
    imageNode = itemNode;
  }

  var titleTextNode = resolveTextNode(titleNode);
  var bodyTextNode = resolveTextNode(bodyNode);

  return {
    title: titleTextNode ? titleTextNode.characters : "",
    titleRuns: textRuns(titleTextNode),
    body: bodyTextNode ? bodyTextNode.characters : "",
    bodyRuns: textRuns(bodyTextNode),
    image: imageSlotData(imageNode)
  };
}

function extractTemplateData(root) {
  var repeatContainers = findAllRepeatContainers(root);
  var exclude = repeatContainers.map(function (c) {
    return c.node.id;
  });

  var titleSlots = findAllNamedSlots(root, TITLE_KEYWORDS, exclude);
  exclude = exclude.concat(titleSlots.map(function (s) { return s.node.id; }));

  var bodySlots = findAllNamedSlots(root, BODY_KEYWORDS, exclude);
  exclude = exclude.concat(bodySlots.map(function (s) { return s.node.id; }));

  var imageSlots = findAllNamedSlots(root, IMAGE_KEYWORDS, exclude);

  // Merge the three independent searches into one map keyed by section
  // name, so e.g. "Title: About" + "Body: About" + "Image: About" (three
  // separate layers anywhere in the tree) become one "about" section.
  var slots = {};
  function ensureSlot(key) {
    if (!slots[key]) {
      slots[key] = {
        title: "", titleRuns: null, foundTitle: false,
        body: "", bodyRuns: null, foundBody: false,
        image: imageSlotData(null), foundImage: false
      };
    }
    return slots[key];
  }

  titleSlots.forEach(function (s) {
    var textNode = resolveTextNode(s.node);
    var slot = ensureSlot(s.key);
    slot.title = textNode ? textNode.characters : "";
    slot.titleRuns = textRuns(textNode);
    slot.foundTitle = !!textNode;
  });
  bodySlots.forEach(function (s) {
    var textNode = resolveTextNode(s.node);
    var slot = ensureSlot(s.key);
    slot.body = textNode ? textNode.characters : "";
    slot.bodyRuns = textRuns(textNode);
    slot.foundBody = !!textNode;
  });
  imageSlots.forEach(function (s) {
    var slot = ensureSlot(s.key);
    slot.image = imageSlotData(s.node);
    slot.foundImage = true;
  });

  var repeats = {};
  repeatContainers.forEach(function (c) {
    repeats[c.key] = "children" in c.node ? c.node.children.map(extractItem) : [];
  });

  // "" is the default/main section - kept as flat title/body/image/found*
  // fields too, so a simple one-section template needs no section keys.
  // (Don't use ensureSlot here - that would add a spurious "" entry to
  // slotKeys even when nothing at all was found under the default key.)
  var mainSlot = slots[""] || {
    title: "", titleRuns: null, foundTitle: false,
    body: "", bodyRuns: null, foundBody: false,
    image: imageSlotData(null), foundImage: false
  };

  return {
    name: root.name,
    title: mainSlot.title,
    titleRuns: mainSlot.titleRuns,
    body: mainSlot.body,
    bodyRuns: mainSlot.bodyRuns,
    image: mainSlot.image,
    foundTitle: mainSlot.foundTitle,
    foundBody: mainSlot.foundBody,
    foundImage: mainSlot.foundImage,
    slots: slots,
    slotKeys: Object.keys(slots),
    repeats: repeats,
    repeatKeys: Object.keys(repeats),
    foundRepeat: repeatContainers.length > 0
  };
}

function handleConvert() {
  var selection = figma.currentPage.selection;
  console.log("[code] handleConvert called, selection length:", selection.length);

  if (selection.length === 0) {
    console.log("[code] no selection, sending error back to ui");
    figma.ui.postMessage({
      type: "error",
      message: "변환할 템플릿 프레임(또는 레이어)을 먼저 선택해주세요."
    });
    return;
  }

  var results = [];
  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    try {
      results.push(extractTemplateData(node));
    } catch (e) {
      console.log("[code] extractTemplateData threw:", e.message || String(e));
      results.push({ name: node.name, error: e.message || String(e) });
    }
  }

  console.log("[code] posting result back to ui, count:", results.length);
  figma.ui.postMessage({ type: "result", results: results });
}

figma.ui.onmessage = function (msg) {
  console.log("[code] figma.ui.onmessage received:", msg);
  if (!msg) return;
  if (msg.type === "convert") {
    handleConvert();
  } else if (msg.type === "close") {
    figma.closePlugin();
  }
};
