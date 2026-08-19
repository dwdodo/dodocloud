// Figma plugin main-thread code.
// Reads the user's current selection, finds "title / body / image" slots by
// layer name, and sends the extracted content back to ui.html for injection
// into a user-supplied HTML template.

figma.showUI(__html__, { width: 460, height: 680 });

// Keyword lists used to guess which layer plays which role.
// Matching is: layer name (lowercased) === keyword, or includes keyword.
var TITLE_KEYWORDS = ["title", "headline", "heading", "제목", "타이틀"];
var BODY_KEYWORDS = ["body", "content", "description", "copy", "본문", "내용", "설명", "text"];
var IMAGE_KEYWORDS = ["image", "photo", "picture", "thumbnail", "이미지", "사진", "img"];

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

async function extractTemplateData(root) {
  var exclude = [];

  var titleNode = findSlotNode(root, TITLE_KEYWORDS, exclude);
  if (titleNode) exclude.push(titleNode.id);

  var bodyNode = findSlotNode(root, BODY_KEYWORDS, exclude);
  if (bodyNode) exclude.push(bodyNode.id);

  var imageNode = findSlotNode(root, IMAGE_KEYWORDS, exclude);

  var title = titleNode && titleNode.type === "TEXT" ? titleNode.characters : "";
  var body = bodyNode && bodyNode.type === "TEXT" ? bodyNode.characters : "";

  var image = "";
  var imageWidth = 0;
  var imageHeight = 0;

  if (imageNode && typeof imageNode.exportAsync === "function") {
    var bytes = await imageNode.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: 2 }
    });
    image = "data:image/png;base64," + figma.base64Encode(bytes);
    imageWidth = Math.round(imageNode.width);
    imageHeight = Math.round(imageNode.height);
  }

  return {
    name: root.name,
    title: title,
    body: body,
    image: image,
    imageWidth: imageWidth,
    imageHeight: imageHeight,
    foundTitle: !!titleNode,
    foundBody: !!bodyNode,
    foundImage: !!imageNode
  };
}

async function handleConvert() {
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
      var data = await extractTemplateData(node);
      results.push(data);
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
