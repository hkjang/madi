package server

import (
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// trackingMaxViolations 는 기록 상한이다. 같은 차단이 페이지마다 반복되므로 횟수가 아니라 서로 다른
// 출처가 중요하다. 출처 100개면 스니펫을 고치기에 충분하다.
const trackingMaxViolations = 100

// trackingViolation 은 정책이 거절한 출처 하나다. 어떤 지시어가 막았는지 함께 두어 무엇을
// 허용해야 하는지 관리 화면이 말할 수 있게 한다.
type trackingViolation struct {
	Origin    string    `json:"origin"`
	Directive string    `json:"directive"`
	Page      string    `json:"page"`
	Count     int       `json:"count"`
	FirstSeen time.Time `json:"first_seen"`
	LastSeen  time.Time `json:"last_seen"`
	Allowed   bool      `json:"allowed"`
}

// trackingRecorder 는 브라우저의 정책 위반 신고를 메모리에 모은다. 감사 기록이 아니라 스니펫을
// 붙이는 사람을 위한 진단 보조이므로 DB 에 두지 않는다.
type trackingRecorder struct {
	mu    sync.Mutex
	items map[string]*trackingViolation
	now   func() time.Time
}

func newTrackingRecorder() *trackingRecorder {
	return &trackingRecorder{items: map[string]*trackingViolation{}, now: time.Now}
}

// record 는 차단 하나를 적는다. 확장 프로그램이나 data: 처럼 http 출처가 아닌 것은 허용할 수도
// 없고 쓸모도 없으므로 버린다.
func (r *trackingRecorder) record(blockedURI, directive, page string) {
	origin := trackingOriginOf(blockedURI)
	if origin == "" {
		return
	}
	directive = strings.ToLower(strings.TrimSpace(directive))
	if at := strings.IndexByte(directive, ' '); at > 0 {
		directive = directive[:at]
	}
	if directive == "" {
		directive = "connect-src"
	}
	if len(page) > 512 {
		page = page[:512]
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := directive + " " + origin
	if existing, ok := r.items[key]; ok {
		existing.Count++
		existing.LastSeen = r.now()
		existing.Page = page
		return
	}
	if len(r.items) >= trackingMaxViolations {
		var oldestKey string
		var oldest time.Time
		for k, v := range r.items {
			if oldestKey == "" || v.LastSeen.Before(oldest) {
				oldestKey, oldest = k, v.LastSeen
			}
		}
		delete(r.items, oldestKey)
	}
	moment := r.now()
	r.items[key] = &trackingViolation{Origin: origin, Directive: directive, Page: page, Count: 1, FirstSeen: moment, LastSeen: moment}
}

// list 는 최근 것부터 돌려준다. 현재 설정이 이미 허용하는 출처는 표시해 고친 스니펫이 계속 보채지
// 않게 한다.
func (r *trackingRecorder) list(cfg trackingConfig) []trackingViolation {
	allowed := map[string]bool{}
	scripts, connects, images := cfg.policySources()
	for _, group := range [][]string{scripts, connects, images} {
		for _, origin := range group {
			allowed[strings.ToLower(strings.TrimSuffix(origin, "/"))] = true
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]trackingViolation, 0, len(r.items))
	for _, v := range r.items {
		copied := *v
		copied.Allowed = allowed[strings.ToLower(copied.Origin)] || trackingMatchesWildcard(copied.Origin, allowed)
		items = append(items, copied)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].LastSeen.Equal(items[j].LastSeen) {
			return items[i].Origin < items[j].Origin
		}
		return items[i].LastSeen.After(items[j].LastSeen)
	})
	return items
}

// forget 은 기록을 비운다. 스니펫을 고친 뒤 아직 막히는 것이 있는지 다시 보는 데 쓴다.
func (r *trackingRecorder) forget() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items = map[string]*trackingViolation{}
}

// trackingMatchesWildcard 는 https://*.google-analytics.com 같은 항목을 맞춘다.
func trackingMatchesWildcard(origin string, allowed map[string]bool) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	lower := strings.ToLower(origin)
	host := strings.ToLower(u.Host)
	for pattern := range allowed {
		star := strings.Index(pattern, "*.")
		if star < 0 {
			continue
		}
		if strings.HasPrefix(lower, pattern[:star]) && strings.HasSuffix(host, pattern[star+1:]) {
			return true
		}
	}
	return false
}
