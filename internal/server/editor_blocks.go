package server

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/reearth/ygo/crdt"
)

func (s *Server) registerEditorBlocks() {
	s.handle("GET /api/v1/documents/{id}/blocks/{blockID}", s.getEditorBlock)
}

// A synced block is a reference, never a copied permission-bypassing snapshot.
// Every refresh uses the source document's current inherited ACL and rejects
// CRDT state superseded by a REST/source edit. Clients clear cached content on
// 403/404/409 instead of keeping a formerly authorized embed on screen.
func (s *Server) getEditorBlock(w http.ResponseWriter, r *http.Request) {
	id, blockID := r.PathValue("id"), r.PathValue("blockID")
	if !validID(id) || blockID == "" || len(blockID) > 128 {
		apiError(w, 400, "블록 주소를 확인하세요")
		return
	}
	p := current(r)
	var state []byte
	var title, markdown, projection string
	var version int
	err := s.DB.QueryRow(r.Context(), `SELECT coalesce(c.state,''::bytea),d.title,d.markdown,coalesce(c.projected_markdown,''),d.version
	 FROM documents d LEFT JOIN document_collaboration c ON c.document_id=d.id
	 WHERE d.id=$1 AND d.deleted_at IS NULL AND madi_document_allowed($2,d.id,false)
	 AND ($3='' OR d.workspace_id::text=$3)`, id, p.ID, p.WorkspaceID).Scan(&state, &title, &markdown, &projection, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		apiError(w, 404, "블록을 찾을 수 없거나 접근 권한이 없습니다")
		return
	}
	// NULL state means this source has not yet been opened in the block editor.
	if err != nil {
		respond(w, nil, err)
		return
	}
	if len(state) == 0 || markdown != projection {
		apiError(w, 409, "원문 변경으로 블록 기준이 갱신되었습니다. 원본 문서에서 새 블록 링크를 복사하세요")
		return
	}
	doc := crdt.New()
	defer doc.Destroy()
	root := doc.GetXmlFragment("content")
	if err = crdt.ApplyUpdateV1(doc, state, nil); err != nil {
		apiError(w, 500, "원본 블록 상태를 읽지 못했습니다")
		return
	}
	var match *crdt.YXmlElement
	count := 0
	var find func(*crdt.YXmlFragment, int)
	find = func(fragment *crdt.YXmlFragment, depth int) {
		if depth > 100 || count > 100000 {
			return
		}
		for _, raw := range fragment.Children() {
			count++
			element, ok := raw.(*crdt.YXmlElement)
			if !ok {
				continue
			}
			if value, ok := element.GetAttribute("id"); ok && value == blockID {
				match = element
				return
			}
			find(&element.YXmlFragment, depth+1)
			if match != nil {
				return
			}
		}
	}
	find(root, 0)
	if match == nil {
		apiError(w, 404, "원본 블록이 삭제되었거나 변경되었습니다")
		return
	}
	node, err := editorBlockNode(match, 0)
	if err != nil {
		apiError(w, 422, err.Error())
		return
	}
	body, err := collaborationRender(node)
	if err != nil {
		apiError(w, 422, err.Error())
		return
	}
	jsonResponse(w, 200, map[string]any{"document_id": id, "block_id": blockID, "title": title, "version": version, "markdown": body, "type": node.Type, "url": "/app/documents/" + id + "#^" + blockID})
}

func editorBlockNode(raw any, depth int) (*collaborationNode, error) {
	if depth > 100 {
		return nil, collaborationError("document_limit", "블록 중첩 깊이를 초과했습니다")
	}
	switch value := raw.(type) {
	case *crdt.YXmlElement:
		n := &collaborationNode{Type: value.NodeName, Attrs: value.GetAttributeValues()}
		for _, child := range value.Children() {
			item, e := editorBlockNode(child, depth+1)
			if e != nil {
				return nil, e
			}
			n.Children = append(n.Children, item)
		}
		return n, nil
	case *crdt.YXmlText:
		n := &collaborationNode{Type: "inline"}
		for _, delta := range value.ToDelta() {
			text, ok := delta.Insert.(string)
			if !ok {
				return nil, collaborationError("unsupported_node", "지원하지 않는 인라인 임베드입니다")
			}
			n.Children = append(n.Children, &collaborationNode{Type: "text", Text: text, Marks: delta.Attributes})
		}
		return n, nil
	}
	return nil, collaborationError("unsupported_node", "지원하지 않는 블록입니다")
}
