package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
)

var mcpVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26"}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations map[string]any `json:"annotations"`
	Scope       string         `json:"-"`
}

func mcpTools() []mcpTool {
	text := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	uuid := func(description string) map[string]any {
		return map[string]any{"type": "string", "format": "uuid", "description": description}
	}
	makeTool := func(name, description, scope string, props map[string]any, required ...string) mcpTool {
		if required == nil {
			required = []string{}
		}
		return mcpTool{Name: name, Description: description, Scope: scope, InputSchema: map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}, Annotations: map[string]any{"readOnlyHint": strings.HasSuffix(scope, ":read"), "destructiveHint": name == "delete_document", "openWorldHint": false}}
	}
	return []mcpTool{
		makeTool("search_documents", "현재 키의 워크스페이스에서 접근 가능한 문서를 검색하여 메타데이터와 최대 600자의 스니펫을 반환합니다. 전체 원문은 document:read 권한의 get_document로 별도 조회하세요.", "search:read", map[string]any{"query": text("검색어"), "workspace_id": uuid("생략하면 API 키의 워크스페이스"), "tag": text("태그 필터")}, "query"),
		makeTool("search_workspace", "워크스페이스 지식의 제한된 검색 스니펫과 메타데이터를 조회합니다. 데이터베이스 결과에는 database:read 권한도 필요합니다.", "search:read", map[string]any{"query": text("검색어"), "workspace_id": uuid("워크스페이스")}, "query"),
		makeTool("get_document", "Markdown 원문과 문서 속성을 조회합니다.", "document:read", map[string]any{"document_id": uuid("문서 ID")}, "document_id"),
		makeTool("create_document", "워크스페이스에 Markdown 문서를 생성합니다.", "document:write", map[string]any{"workspace_id": uuid("생략하면 API 키의 워크스페이스"), "title": text("문서 제목"), "markdown": text("Markdown 원문"), "visibility": map[string]any{"type": "string", "enum": []string{"workspace", "private"}}, "tags": map[string]any{"type": "array", "items": text("태그")}}, "title"),
		makeTool("update_document", "기존 문서를 수정합니다. 먼저 조회한 version을 제공하여 동시 수정 충돌을 방지하세요.", "document:write", map[string]any{"document_id": uuid("문서 ID"), "version": map[string]any{"type": "integer", "minimum": 1}, "title": text("문서 제목"), "markdown": text("Markdown 원문"), "tags": map[string]any{"type": "array", "items": text("태그")}}, "document_id", "version"),
		makeTool("delete_document", "문서를 휴지통으로 이동합니다. 영구 삭제하지 않습니다.", "document:write", map[string]any{"document_id": uuid("문서 ID")}, "document_id"),
		makeTool("get_backlinks", "문서를 참조하는 접근 가능한 문서 목록을 조회합니다.", "document:read", map[string]any{"document_id": uuid("문서 ID")}, "document_id"),
		makeTool("get_graph", "워크스페이스의 문서 연결 그래프를 조회합니다.", "document:read", map[string]any{"workspace_id": uuid("생략하면 API 키의 워크스페이스")}),
		makeTool("list_databases", "워크스페이스의 데이터베이스 목록을 조회합니다.", "database:read", map[string]any{"workspace_id": uuid("생략하면 API 키의 워크스페이스")}),
		makeTool("query_database", "접근 가능한 데이터베이스의 행 목록을 조회합니다.", "database:read", map[string]any{"database_id": uuid("데이터베이스 ID")}, "database_id"),
		makeTool("create_database_row", "데이터베이스에 속성 값을 가진 새 행을 생성합니다.", "database:write", map[string]any{"database_id": uuid("데이터베이스 ID"), "values": map[string]any{"type": "object", "description": "속성 ID를 키로 하는 값"}}, "database_id", "values"),
	}
}

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func mcpResult(w http.ResponseWriter, id json.RawMessage, result any) {
	jsonResponse(w, 200, map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}
func mcpError(w http.ResponseWriter, id json.RawMessage, code int, message string) {
	jsonResponse(w, 200, map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}})
}

func (s *Server) mcp(w http.ResponseWriter, r *http.Request) {
	p := current(r)
	if p.TokenID == "" {
		apiError(w, 401, "MCP 연결에는 범위가 지정된 API 키가 필요합니다.")
		return
	}
	if !s.sameOrigin(r) {
		apiError(w, 403, "허용되지 않은 요청 출처입니다.")
		return
	}
	version := r.Header.Get("MCP-Protocol-Version")
	if version != "" && !slices.Contains(mcpVersions, version) {
		apiError(w, 400, "지원하는 MCP 버전: "+strings.Join(mcpVersions, ", "))
		return
	}
	if accept := r.Header.Get("Accept"); accept != "" && !strings.Contains(accept, "application/json") && !strings.Contains(accept, "*/*") {
		apiError(w, 406, "Accept에 application/json을 포함하세요.")
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		apiError(w, 415, "Content-Type: application/json이 필요합니다.")
		return
	}
	var in mcpRequest
	if err := decode(r, &in); err != nil {
		mcpError(w, nil, -32700, "유효한 단일 JSON-RPC 객체가 필요합니다.")
		return
	}
	if in.JSONRPC != "2.0" || in.Method == "" {
		mcpError(w, in.ID, -32600, "JSON-RPC 2.0 요청이 필요합니다.")
		return
	}
	if len(in.ID) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	var id any
	if json.Unmarshal(in.ID, &id) != nil {
		mcpError(w, nil, -32600, "유효한 요청 ID가 필요합니다.")
		return
	}
	switch id.(type) {
	case string, float64:
	default:
		mcpError(w, nil, -32600, "요청 ID는 문자열 또는 숫자여야 합니다.")
		return
	}
	switch in.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		if json.Unmarshal(in.Params, &params) != nil || params.ProtocolVersion == "" {
			mcpError(w, in.ID, -32602, "protocolVersion이 필요합니다.")
			return
		}
		selected := params.ProtocolVersion
		if !slices.Contains(mcpVersions, selected) {
			selected = mcpVersions[0]
		}
		mcpResult(w, in.ID, map[string]any{"protocolVersion": selected, "capabilities": map[string]any{"tools": map[string]any{"listChanged": false}}, "serverInfo": map[string]any{"name": "madi", "version": s.Version}, "instructions": "모든 도구는 API 키의 권한, 워크스페이스, 사용자 문서 접근 권한을 적용합니다. 문서 수정 전에 최신 version을 조회하세요."})
	case "ping":
		mcpResult(w, in.ID, map[string]any{})
	case "tools/list":
		out := []mcpTool{}
		for _, tool := range mcpTools() {
			if hasIntegrationScope(p, tool.Scope) {
				out = append(out, tool)
			}
		}
		mcpResult(w, in.ID, map[string]any{"tools": out})
	case "tools/call":
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if json.Unmarshal(in.Params, &params) != nil || params.Name == "" {
			mcpError(w, in.ID, -32602, "도구 이름과 arguments를 확인하세요.")
			return
		}
		var found *mcpTool
		for _, tool := range mcpTools() {
			if tool.Name == params.Name {
				found = &tool
				break
			}
		}
		if found == nil {
			mcpError(w, in.ID, -32602, "알 수 없는 도구입니다.")
			return
		}
		if !hasIntegrationScope(p, found.Scope) {
			mcpResult(w, in.ID, mcpToolResult(nil, "API 키의 권한 범위를 벗어난 도구입니다."))
			return
		}
		if params.Arguments == nil {
			params.Arguments = map[string]any{}
		}
		method, path, body, err := mcpDispatch(params.Name, params.Arguments, p.WorkspaceID)
		if err != nil {
			mcpError(w, in.ID, -32602, err.Error())
			return
		}
		encoded, _ := json.Marshal(body)
		internal, err := http.NewRequestWithContext(context.WithValue(r.Context(), integrationCountedTokenKey{}, p.TokenID), method, path, bytes.NewReader(encoded))
		if err != nil {
			mcpError(w, in.ID, -32603, "요청을 구성하지 못했습니다.")
			return
		}
		internal.Header = r.Header.Clone()
		internal.Header.Set("Content-Type", "application/json")
		internal.Header.Set("X-Madi-Request", "1")
		internal.Host = r.Host
		internal.RemoteAddr = r.RemoteAddr
		internal.TLS = r.TLS
		recorder := httptest.NewRecorder()
		s.mux.ServeHTTP(recorder, internal)
		var result any
		if json.Unmarshal(recorder.Body.Bytes(), &result) != nil {
			mcpResult(w, in.ID, mcpToolResult(nil, "도구 응답을 해석하지 못했습니다."))
			return
		}
		if recorder.Code >= 400 {
			mcpResult(w, in.ID, mcpToolResult(result, "요청을 처리하지 못했습니다."))
			return
		}
		mcpResult(w, in.ID, mcpToolResult(result, ""))
	default:
		mcpError(w, in.ID, -32601, "지원하지 않는 MCP 메서드입니다.")
	}
}

func mcpToolResult(value any, message string) map[string]any {
	if value == nil {
		value = map[string]any{"error": message}
	}
	encoded, _ := json.Marshal(value)
	return map[string]any{"content": []map[string]any{{"type": "text", "text": string(encoded)}}, "structuredContent": map[string]any{"result": value}, "isError": message != ""}
}

func mcpDispatch(name string, args map[string]any, defaultWorkspace string) (string, string, map[string]any, error) {
	wid := str(args, "workspace_id")
	if wid == "" {
		wid = defaultWorkspace
	}
	bad := func(message string) (string, string, map[string]any, error) {
		return "", "", nil, fmt.Errorf("%s", message)
	}
	for _, field := range []string{"workspace_id", "document_id", "database_id"} {
		if value, ok := args[field]; ok {
			id, ok := value.(string)
			if !ok || !validID(id) {
				return bad(field + "는 UUID여야 합니다.")
			}
		}
	}
	for _, tool := range mcpTools() {
		if tool.Name != name {
			continue
		}
		props := tool.InputSchema["properties"].(map[string]any)
		for key := range args {
			if _, ok := props[key]; !ok {
				return bad("지원하지 않는 매개변수: " + key)
			}
		}
		for _, key := range tool.InputSchema["required"].([]string) {
			if _, ok := args[key]; !ok {
				return bad("필수 매개변수: " + key)
			}
		}
	}
	body := map[string]any{}
	for key, value := range args {
		if key != "document_id" && key != "database_id" {
			body[key] = value
		}
	}
	switch name {
	case "search_documents", "search_workspace":
		query, ok := args["query"].(string)
		if !ok || strings.TrimSpace(query) == "" {
			return bad("query 검색어를 입력하세요.")
		}
		values := url.Values{"workspace_id": {wid}, "q": {query}, "tag": {str(args, "tag")}}
		if name == "search_documents" {
			values.Set("type", "document")
		}
		return "GET", "/api/v1/search?" + values.Encode(), nil, nil
	case "get_document":
		return "GET", "/api/v1/documents/" + str(args, "document_id"), nil, nil
	case "create_document":
		body["workspace_id"] = wid
		return "POST", "/api/v1/documents", body, nil
	case "update_document":
		return "PUT", "/api/v1/documents/" + str(args, "document_id"), body, nil
	case "delete_document":
		return "DELETE", "/api/v1/documents/" + str(args, "document_id"), nil, nil
	case "get_backlinks":
		return "GET", "/api/v1/documents/" + str(args, "document_id") + "/backlinks", nil, nil
	case "get_graph":
		return "GET", "/api/v1/graph?workspace_id=" + url.QueryEscape(wid), nil, nil
	case "list_databases":
		return "GET", "/api/v1/databases?workspace_id=" + url.QueryEscape(wid), nil, nil
	case "query_database":
		return "GET", "/api/v1/databases/" + str(args, "database_id") + "/rows", nil, nil
	case "create_database_row":
		return "POST", "/api/v1/databases/" + str(args, "database_id") + "/rows", body, nil
	}
	return bad("지원하지 않는 도구입니다.")
}
