/* =====================================================================
   채용공고 편집기 — Firebase 연결 설정
   ---------------------------------------------------------------------
   1) Firebase 콘솔 > 프로젝트 설정 > 내 앱 > "SDK 설정 및 구성"에서
      firebaseConfig 값을 복사해서 아래 config 안을 통째로 바꿔 주세요.
   2) adminEmail 은 Firebase Authentication 에 만든 관리자 계정 이메일과
      Firestore 보안 규칙에 적은 이메일, 세 곳 모두 같아야 해요.
   ※ 이 값들은 공개돼도 괜찮아요. 실제 보호는 비밀번호 + 보안 규칙이 해요.
   ===================================================================== */
window.CLE_FIREBASE = {
  config: {
    apiKey: "AIzaSyAhu9F_gwlApbodDVvpAAqAHMTJyGSKJCk",
    authDomain: "cle-tools.firebaseapp.com",
    projectId: "cle-tools",
    storageBucket: "cle-tools.firebasestorage.app",
    messagingSenderId: "779365565427",
    appId: "1:779365565427:web:783b79f074f3ca53198886"
  },
  adminEmail: "jobpost@clerobotics.com"
};
