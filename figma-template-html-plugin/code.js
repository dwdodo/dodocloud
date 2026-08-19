// Figma plugin main-thread code.
//
// Reads the user's current selection and extracts:
//   - a top-level title / body text
//   - a top-level "image slot" (position/size only — no pixels are exported)
//   - an optional repeatable item group (title/body/image per item), whose
//     item COUNT is whatever the marketing team left in the Figma file
//     (they duplicate/delete item layers themselves; this plugin just counts
//     however many are there at conversion time).
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
var REPEAT_KEYWORDS = ["items", "item", "list", "repeat", "카드", "반복", "목록", "리스트"];

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

function imageSlotData(imageNode) {
  if (!imageNode) return { present: false, width: 0, height: 0 };
  return {
    present: true,
    width: Math.round(imageNode.width),
    height: Math.round(imageNode.height)
  };
}

// Extracts title/body/image for a single item inside a repeat group.
function extractItem(itemNode) {
  if (itemNode.type === "TEXT") {
    return { title: itemNode.characters, body: "", image: imageSlotData(null) };
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

  return {
    title: titleNode && titleNode.type === "TEXT" ? titleNode.characters : "",
    body: bodyNode && bodyNode.type === "TEXT" ? bodyNode.characters : "",
    image: imageSlotData(imageNode)
  };
}

function extractTemplateData(root) {
  var exclude = [];

  var titleNode = findSlotNode(root, TITLE_KEYWORDS, exclude);
  if (titleNode) exclude.push(titleNode.id);

  var bodyNode = findSlotNode(root, BODY_KEYWORDS, exclude);
  if (bodyNode) exclude.push(bodyNode.id);

  // Find the repeat container before the top-level image search, and
  // exclude its whole subtree so per-item images don't get picked up as
  // "the" top-level image.
  var repeatNode = findSlotNode(root, REPEAT_KEYWORDS, exclude);
  if (repeatNode) exclude.push(repeatNode.id);

  var imageNode = findSlotNode(root, IMAGE_KEYWORDS, exclude);

  var items = null;
  if (repeatNode && "children" in repeatNode) {
    items = repeatNode.children.map(extractItem);
  }

  return {
    name: root.name,
    title: titleNode && titleNode.type === "TEXT" ? titleNode.characters : "",
    body: bodyNode && bodyNode.type === "TEXT" ? bodyNode.characters : "",
    image: imageSlotData(imageNode),
    items: items,
    foundTitle: !!titleNode,
    foundBody: !!bodyNode,
    foundImage: !!imageNode,
    foundRepeat: !!repeatNode
  };
}

function handleConvert() {
  var selection = figma.currentPage.selection;

  if (selection.length === 0) {
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
      results.push({ name: node.name, error: e.message || String(e) });
    }
  }

  figma.ui.postMessage({ type: "result", results: results });
}

figma.ui.onmessage = function (msg) {
  if (!msg) return;
  if (msg.type === "convert") {
    handleConvert();
  } else if (msg.type === "close") {
    figma.closePlugin();
  }
};
