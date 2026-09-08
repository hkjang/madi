# 배포판에서 빠진 라이선스 원문

`scripts/licenses.mjs`는 설치된 npm 런타임 의존성과 실제 Go 서비스 import 모듈에서 라이선스·NOTICE를 모아 `web/public/licenses.txt`에 포함합니다. npm README에 포함된 완전한 라이선스도 보존합니다. 아래 두 원문은 설치 패키지에 파일이 없어 공식 저장소의 고정 버전에서 가져왔습니다.

- Go: https://github.com/golang/go/blob/go1.26.0/LICENSE
- react-remove-scroll-bar 2.3.8은 package.json과 README에 MIT를 선언하지만 배포본 및 당시 npm gitHead에 전체 LICENSE 파일은 없습니다. 같은 공식 프로젝트가 추가한 MIT 원문을 고정해 보존합니다: https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE

업스트림 텍스트를 변경하지 않습니다. 생성 manifest는 의존성 잠금 파일과 각 원문의 SHA-256을 기록합니다. 이 모음은 madi 자체의 소프트웨어 라이선스를 지정하지 않습니다.
