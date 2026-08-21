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
var BODY_KEYWORDS = ["body", "content", "description", "copy", "본문", "내용", "설명", "text", "텍스트"];
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
// itself (e.g. a "Title" frame containing "소제목" + "대제목" as two
// separate, unrelated-looking text layers one level in, rather than one
// text layer with two lines). Collects every text layer found anywhere
// inside the matched node (in tree/layer-panel order), so naming the
// wrapper is enough - you don't have to name the text layer(s) themselves,
// and a title/body split across multiple text layers is still captured
// in full rather than just the first one found.
function allTextDescendants(node) {
  var result = [];
  var queue = [node];
  while (queue.length > 0) {
    var current = queue.shift();
    if (current.type === "TEXT") {
      result.push(current);
      continue;
    }
    if ("children" in current) {
      for (var c = 0; c < current.children.length; c++) {
        queue.push(current.children[c]);
      }
    }
  }
  return result;
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

// Resolves a matched title/body node down to its actual text content: the
// node itself if it's already TEXT, or every text layer found inside it
// (joined with newlines) if it's a wrapping frame/group - so "타이틀"
// containing separate "소제목" + "대제목" text layers comes out as both
// lines combined, not just whichever one is found first.
//
// When there's more than one text layer inside, each one is ALSO exposed
// individually under `parts`, keyed by that text layer's own name (e.g.
// "소제목", "대제목") - so the HTML side can address them as two separate
// elements ("title:혜택.소제목" / "title:혜택.대제목") when the combined
// single-element text isn't what's wanted, without any extra Figma naming.
function combinedTextAndRuns(node) {
  if (!node) return { text: "", runs: null, parts: null };
  if (node.type === "TEXT") return { text: node.characters, runs: textRuns(node), parts: null };

  var textNodes = allTextDescendants(node);
  if (textNodes.length === 0) return { text: "", runs: null, parts: null };
  if (textNodes.length === 1) {
    return { text: textNodes[0].characters, runs: textRuns(textNodes[0]), parts: null };
  }

  var parts = {};
  textNodes.forEach(function (tn) {
    var partKey = (tn.name || "").trim().toLowerCase();
    if (partKey) parts[partKey] = { text: tn.characters, runs: textRuns(tn) };
  });

  var texts = [];
  var runs = [];
  textNodes.forEach(function (tn, idx) {
    texts.push(tn.characters);
    var tnRuns = textRuns(tn);
    if (tnRuns) {
      runs = runs.concat(tnRuns);
    } else if (tn.characters) {
      runs.push({ text: tn.characters, fontSize: null, color: null });
    }
    if (idx < textNodes.length - 1) runs.push({ text: "\n", fontSize: null, color: null });
  });
  return { text: texts.join("\n"), runs: runs.length > 0 ? runs : null, parts: parts };
}

// Extracts title/body/image for a single item inside a repeat group.
function extractItem(itemNode) {
  if (itemNode.type === "TEXT") {
    return {
      title: itemNode.characters,
      titleRuns: textRuns(itemNode),
      titleParts: null,
      body: "",
      bodyRuns: null,
      bodyParts: null,
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

  var titleResolved = combinedTextAndRuns(titleNode);
  var bodyResolved = combinedTextAndRuns(bodyNode);

  console.log(
    "[code] item '" + itemNode.name + "':",
    "title <-", titleNode ? titleNode.name : null, "=>", titleResolved.text || "(none)",
    "| body <-", bodyNode ? bodyNode.name : null, "=>", bodyResolved.text || "(none)",
    "| image:", !!imageNode
  );

  return {
    title: titleResolved.text,
    titleRuns: titleResolved.runs,
    titleParts: titleResolved.parts,
    body: bodyResolved.text,
    bodyRuns: bodyResolved.runs,
    bodyParts: bodyResolved.parts,
    image: imageSlotData(imageNode)
  };
}

// Classifies a single child of a repeat group as a "block" - either a
// text block or an image block - for repeat groups that hold a free-form,
// ORDERED sequence of paragraphs and images (e.g. "text, image, image" or
// "image, text") rather than a fixed title+body+image shape per item. The
// child's position in the array is preserved, so reordering/duplicating
// layers in Figma reorders/duplicates blocks in the output the same way.
function classifyBlock(node) {
  if (node.type === "TEXT") {
    return { type: "text", text: node.characters, runs: textRuns(node) };
  }

  var textNodes = allTextDescendants(node);
  if (textNodes.length > 0) {
    var combined = combinedTextAndRuns(node);
    return { type: "text", text: combined.text, runs: combined.runs };
  }

  var imgNode = findSlotNode(node, IMAGE_KEYWORDS, []);
  return { type: "image", image: imageSlotData(imgNode || node) };
}

function extractTemplateData(root) {
  var repeatContainers = findAllRepeatContainers(root);
  var globalExclude = repeatContainers.map(function (c) {
    return c.node.id;
  });

  // Auto-detect implicit "sections": direct children of root that aren't
  // themselves a title/body/image match and aren't a repeat container.
  // Each becomes its own section, keyed by its own layer name - so a
  // multi-section page (Hero/About/Menu as three sibling top-level frames,
  // which is how people naturally organize these things) doesn't need every
  // title/body/image inside it explicitly tagged "Title: about" etc. An
  // explicit "Title: <key>" still works too and takes that key as usual.
  var sectionChildren = [];
  if ("children" in root) {
    root.children.forEach(function (child) {
      if (globalExclude.indexOf(child.id) !== -1) return;
      if (
        parseNamedSlot(child.name, TITLE_KEYWORDS) !== null ||
        parseNamedSlot(child.name, BODY_KEYWORDS) !== null ||
        parseNamedSlot(child.name, IMAGE_KEYWORDS) !== null
      ) {
        return;
      }
      sectionChildren.push(child);
    });
  }

  var slots = {};
  function ensureSlot(key) {
    if (!slots[key]) {
      slots[key] = {
        title: "", titleRuns: null, titleParts: null, foundTitle: false,
        body: "", bodyRuns: null, bodyParts: null, foundBody: false,
        image: imageSlotData(null), foundImage: false
      };
    }
    return slots[key];
  }

  // Scans `scopeNode` for title/body/image layers; a BARE match (no
  // "Title: key" suffix) is filed under `defaultKey` instead of "" - so
  // each auto-detected section scans its own subtree with its own name as
  // the fallback key, while an explicit "Title: xyz" anywhere still wins.
  function collectSlotsFrom(scopeNode, baseExclude, defaultKey, sectionLabel) {
    var exclude = baseExclude.slice();

    var titleSlots = findAllNamedSlots(scopeNode, TITLE_KEYWORDS, exclude);
    exclude = exclude.concat(titleSlots.map(function (s) { return s.node.id; }));
    var bodySlots = findAllNamedSlots(scopeNode, BODY_KEYWORDS, exclude);
    exclude = exclude.concat(bodySlots.map(function (s) { return s.node.id; }));
    var imageSlots = findAllNamedSlots(scopeNode, IMAGE_KEYWORDS, exclude);

    titleSlots.forEach(function (s) {
      var key = s.key || defaultKey;
      var resolved = combinedTextAndRuns(s.node);
      var slot = ensureSlot(key);
      if (slot.foundTitle) {
        console.log(
          "[code] WARNING: two layers both map to title key '" + key + "' (section: " + sectionLabel +
          ") - '" + s.node.name + "' overwrites the previous match."
        );
      }
      slot.title = resolved.text;
      slot.titleRuns = resolved.runs;
      slot.titleParts = resolved.parts;
      slot.foundTitle = !!resolved.text || resolved.runs !== null;
      console.log(
        "[code] title section '" + (key || "(기본)") + "' (from " + sectionLabel + ") <- layer '" + s.node.name + "'",
        "=> resolved text:", resolved.text || "(찾은 텍스트 없음)"
      );
    });
    bodySlots.forEach(function (s) {
      var key = s.key || defaultKey;
      var resolved = combinedTextAndRuns(s.node);
      var slot = ensureSlot(key);
      if (slot.foundBody) {
        console.log(
          "[code] WARNING: two layers both map to body key '" + key + "' (section: " + sectionLabel +
          ") - '" + s.node.name + "' overwrites the previous match."
        );
      }
      slot.body = resolved.text;
      slot.bodyRuns = resolved.runs;
      slot.bodyParts = resolved.parts;
      slot.foundBody = !!resolved.text || resolved.runs !== null;
      console.log(
        "[code] body section '" + (key || "(기본)") + "' (from " + sectionLabel + ") <- layer '" + s.node.name + "'",
        "=> resolved text:", resolved.text || "(찾은 텍스트 없음)"
      );
    });
    imageSlots.forEach(function (s) {
      var key = s.key || defaultKey;
      var slot = ensureSlot(key);
      slot.image = imageSlotData(s.node);
      slot.foundImage = true;
      console.log("[code] image section '" + (key || "(기본)") + "' (from " + sectionLabel + ") <- layer '" + s.node.name + "'");
    });
  }

  var sectionExclude = globalExclude.concat(sectionChildren.map(function (c) { return c.id; }));
  collectSlotsFrom(root, sectionExclude, "", "루트");
  sectionChildren.forEach(function (child) {
    var key = child.name.trim().toLowerCase();
    collectSlotsFrom(child, globalExclude, key, child.name);
  });

  var repeats = {};
  var repeatBlocks = {};
  repeatContainers.forEach(function (c) {
    console.log("[code] repeat group '" + c.key + "' <- layer '" + c.node.name + "'");
    var children = "children" in c.node ? c.node.children : [];
    repeats[c.key] = children.map(extractItem);
    // Parallel "blocks" view of the same children, for repeat groups used
    // as a free-form ordered text/image sequence rather than fixed items -
    // see classifyBlock. Whichever the HTML template actually addresses
    // (data-figma-repeat vs. data-figma-repeat + data-figma-repeat-type
    // variants) is decided entirely on the ui.html side.
    repeatBlocks[c.key] = children.map(classifyBlock);
  });

  // "" is the default/main section - kept as flat title/body/image/found*
  // fields too, so a simple one-section template needs no section keys.
  // (Don't use ensureSlot here - that would add a spurious "" entry to
  // slotKeys even when nothing at all was found under the default key.)
  var mainSlot = slots[""] || {
    title: "", titleRuns: null, titleParts: null, foundTitle: false,
    body: "", bodyRuns: null, bodyParts: null, foundBody: false,
    image: imageSlotData(null), foundImage: false
  };

  return {
    name: root.name,
    title: mainSlot.title,
    titleRuns: mainSlot.titleRuns,
    titleParts: mainSlot.titleParts,
    body: mainSlot.body,
    bodyRuns: mainSlot.bodyRuns,
    bodyParts: mainSlot.bodyParts,
    image: mainSlot.image,
    foundTitle: mainSlot.foundTitle,
    foundBody: mainSlot.foundBody,
    foundImage: mainSlot.foundImage,
    slots: slots,
    slotKeys: Object.keys(slots),
    repeats: repeats,
    repeatBlocks: repeatBlocks,
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
