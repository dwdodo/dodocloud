# Template to HTML (Figma Plugin)

Figma에서 만든 "타이틀 + 본문 + 이미지" 구조의 템플릿 디자인을,
사용자가 준비한 HTML 틀(스켈레톤)에 맞춰 실제 콘텐츠가 채워진 HTML로 변환해주는 플러그인입니다.

## 설치 (개발 모드로 불러오기)

1. Figma 데스크톱 앱에서 **Plugins → Development → Import plugin from manifest…** 선택
2. 이 폴더의 `manifest.json` 선택
3. 좌측 메뉴 **Plugins → Development → Template to HTML** 실행

빌드 과정 없이 순수 JS/HTML로만 구성되어 있어 바로 사용할 수 있습니다.

## 사용 방법

1. 캔버스에서 타이틀/본문/이미지 레이어를 포함하는 **프레임(또는 그룹)** 을 선택합니다.
   - 여러 프레임을 동시에 선택하면 각각 변환됩니다.
2. 플러그인 UI에 원하는 HTML 틀을 붙여넣습니다(기본 예시가 채워져 있습니다).
3. **"Figma에서 변환하기"** 클릭
4. 결과 HTML을 복사하거나 `.html` 파일로 다운로드합니다.

## 레이어 인식 규칙 (Figma 쪽)

선택한 프레임의 하위 레이어를 이름으로 검색해 역할을 추정합니다(대소문자 무시, 부분 일치):

| 역할  | 인식 키워드 (레이어 이름에 포함되면 매칭) |
|-------|-------------------------------------------|
| Title | `title`, `headline`, `heading`, `제목`, `타이틀` |
| Body  | `body`, `content`, `description`, `copy`, `text`, `본문`, `내용`, `설명` |
| Image | `image`, `photo`, `picture`, `thumbnail`, `img`, `이미지`, `사진` |

- Title/Body는 **텍스트 레이어**여야 실제 텍스트(`characters`)를 추출합니다.
- Image는 어떤 레이어 타입이든 PNG로 내보내기(export) 가능하면 추출됩니다(2x 스케일).
- 검색은 프레임 최상단부터 하위 방향으로 진행되며, 이미 Title/Body로 매칭된 레이어는
  Body/Image 검색에서 제외됩니다.
- 가장 안전한 방법은 레이어 이름을 정확히 `Title`, `Body`, `Image`로 지정하는 것입니다.

## HTML 틀 작성 규칙 (HTML 쪽)

HTML 틀에는 아래 3개의 `data-figma-slot` 속성을 가진 요소가 있어야 합니다:

```html
<img  data-figma-slot="image" src="" alt="" />
<h1   data-figma-slot="title"></h1>
<div  data-figma-slot="body"></div>
```

- `data-figma-slot="title"` : 요소의 텍스트로 타이틀이 채워집니다.
- `data-figma-slot="body"`  : 요소의 내용으로 본문이 채워집니다(줄바꿈은 `<br>`로 변환).
- `data-figma-slot="image"` : `<img>` 태그면 `src`(base64 data URI)와 `width`/`height`가 채워지고,
  다른 태그(예: `<div>`)면 `background-image` 스타일로 채워집니다.

세 슬롯 모두 선택이며, 틀에 없는 슬롯은 그냥 무시됩니다. 여러 개의 서로 다른 HTML 틀을
자유롭게 만들어 붙여넣을 수 있습니다 — 플러그인은 슬롯 속성만 찾아서 채웁니다.

## 제한 사항 / 향후 개선 아이디어

- 현재는 프레임당 Title 1개 / Body 1개 / Image 1개만 지원합니다(반복되는 리스트형 템플릿은 미지원).
- 이미지는 base64로 인라인되어 HTML 파일 하나로 결과가 나옵니다(파일 크기가 커질 수 있음).
- 필요하면 `data-figma-slot="title-2"`처럼 확장하거나, 여러 개의 결과를 zip으로 묶는 기능을
  추가할 수 있습니다.
