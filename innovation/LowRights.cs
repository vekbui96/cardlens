// Start a process under a REDUCED token, and read a process's real token state.
//
// Why: on server-pc, Windows gives this admin account a FULL token for non-interactive logons (scheduled
// tasks), whatever the task's RunLevel says: no UAC split token is created, so "Limited" does nothing.
// run-loop.ps1 therefore drops rights itself before starting the claude session.
//
// How: SaferComputeTokenFromLevel(SAFER_LEVELID_NORMALUSER) turns the caller's token into a normal-user one
// (Administrators becomes deny-only, admin privileges removed: what `runas /trustlevel:0x20000` does), the
// integrity level is lowered to Medium, and the child is created with CreateProcessAsUser (allowed without
// SeAssignPrimaryToken because the token is a restricted version of the caller's own), falling back to
// CreateProcessWithTokenW. stdin/stdout/stderr are redirected to files through inheritable handles.
// Loaded by lib.ps1 (Add-Type). No secrets involved.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class CardlensLowRights
{
    const uint SAFER_SCOPEID_USER = 2, SAFER_LEVELID_NORMALUSER = 0x20000, SAFER_LEVEL_OPEN = 1;
    const int TokenElevationType = 18, TokenElevation = 20, TokenIntegrityLevel = 25;
    const uint SE_GROUP_INTEGRITY = 0x20;
    const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000, FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2;
    const uint OPEN_EXISTING = 3, CREATE_ALWAYS = 2, FILE_ATTRIBUTE_NORMAL = 0x80;
    const uint STARTF_USESTDHANDLES = 0x100, STARTF_USESHOWWINDOW = 1;
    const uint CREATE_NO_WINDOW = 0x08000000, CREATE_UNICODE_ENVIRONMENT = 0x400;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x8, TOKEN_DUPLICATE = 0x2;

    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }

    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SaferCreateLevel(uint scope, uint level, uint flags, out IntPtr hLevel, IntPtr reserved);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SaferComputeTokenFromLevel(IntPtr hLevel, IntPtr inToken, out IntPtr outToken, uint flags, IntPtr reserved);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SaferCloseLevel(IntPtr hLevel);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
    [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr h, int cls, IntPtr info, int len);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr h, int cls, IntPtr info, int len, out int ret);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr tok);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateToken(IntPtr tok, int level, out IntPtr dup);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CheckTokenMembership(IntPtr tok, IntPtr sid, out bool isMember);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr tok, string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessWithTokenW(IntPtr tok, uint logonFlags, string app, System.Text.StringBuilder cmd, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disp, uint attrs, IntPtr tmpl);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeName(string sys, IntPtr luid, System.Text.StringBuilder name, ref int len);

    static IntPtr OpenInheritable(string path, bool write) {
        var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = true };
        IntPtr h = write
            ? CreateFile(path, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero)
            : CreateFile(path, GENERIC_READ, FILE_SHARE_READ, ref sa, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (h == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateFile " + path);
        return h;
    }

    // Normal-user, Medium-integrity primary token derived from this process's token. Caller closes it.
    public static IntPtr CreateReducedToken() {
        IntPtr level, tok;
        if (!SaferCreateLevel(SAFER_SCOPEID_USER, SAFER_LEVELID_NORMALUSER, SAFER_LEVEL_OPEN, out level, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SaferCreateLevel");
        try {
            if (!SaferComputeTokenFromLevel(level, IntPtr.Zero, out tok, 0, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SaferComputeTokenFromLevel");
        } finally { SaferCloseLevel(level); }
        IntPtr sid;
        if (!ConvertStringSidToSid("S-1-16-8192", out sid)) throw new Win32Exception(Marshal.GetLastWin32Error(), "ConvertStringSidToSid");
        try {
            var tml = new SID_AND_ATTRIBUTES { Sid = sid, Attributes = SE_GROUP_INTEGRITY };
            int size = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)) + GetLengthSid(sid);
            IntPtr buf = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(tml, buf, false);
                if (!SetTokenInformation(tok, TokenIntegrityLevel, buf, size))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "SetTokenInformation(integrity)");
            } finally { Marshal.FreeHGlobal(buf); }
        } finally { LocalFree(sid); }
        return tok;
    }

    // Returns "pid|processHandle|method". The caller waits with Wait(handle, ms) and then CloseProcess(handle).
    public static string Start(string app, string commandLine, string cwd, string stdinPath, string stdoutPath, string stderrPath) {
        IntPtr tok = CreateReducedToken();
        IntPtr hIn = IntPtr.Zero, hOut = IntPtr.Zero, hErr = IntPtr.Zero;
        try {
            hIn = stdinPath != null && stdinPath.Length > 0 ? OpenInheritable(stdinPath, false) : OpenInheritable("NUL", false);
            hOut = OpenInheritable(stdoutPath, true);
            hErr = OpenInheritable(stderrPath, true);
            var si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
            si.wShowWindow = 0;
            si.hStdInput = hIn; si.hStdOutput = hOut; si.hStdError = hErr;
            PROCESS_INFORMATION pi;
            var cmd = new System.Text.StringBuilder(commandLine);
            string method = "CreateProcessAsUser";
            if (!CreateProcessAsUser(tok, app, cmd, IntPtr.Zero, IntPtr.Zero, true, CREATE_NO_WINDOW, IntPtr.Zero, cwd, ref si, out pi)) {
                int err = Marshal.GetLastWin32Error();
                method = "CreateProcessWithTokenW (CreateProcessAsUser failed: " + err + ")";
                cmd = new System.Text.StringBuilder(commandLine);
                if (!CreateProcessWithTokenW(tok, 0, app, cmd, CREATE_NO_WINDOW, IntPtr.Zero, cwd, ref si, out pi))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessWithTokenW (after CreateProcessAsUser error " + err + ")");
            }
            CloseHandle(pi.hThread);
            return pi.dwProcessId + "|" + pi.hProcess.ToInt64() + "|" + method;
        } finally {
            if (hIn != IntPtr.Zero) CloseHandle(hIn);
            if (hOut != IntPtr.Zero) CloseHandle(hOut);
            if (hErr != IntPtr.Zero) CloseHandle(hErr);
            CloseHandle(tok);
        }
    }

    // Token state of any process we can open: "elevated=<0|1> elevationType=<1|2|3> integrity=0x<rid> adminEnabled=<True|False>".
    public static string Inspect(int pid) {
        IntPtr p = pid == 0 ? GetCurrentProcess() : OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (p == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess " + pid);
        IntPtr tok;
        if (!OpenProcessToken(p, TOKEN_QUERY | TOKEN_DUPLICATE, out tok)) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken " + pid);
        try {
            int elevated = QueryInt(tok, TokenElevation), type = QueryInt(tok, TokenElevationType);
            int ret; IntPtr buf = Marshal.AllocHGlobal(256); int rid = -1;
            try {
                if (GetTokenInformation(tok, TokenIntegrityLevel, buf, 256, out ret)) {
                    IntPtr sid = Marshal.ReadIntPtr(buf);
                    int subCount = Marshal.ReadByte(sid, 1);
                    rid = Marshal.ReadInt32(sid, 8 + 4 * (subCount - 1));
                }
            } finally { Marshal.FreeHGlobal(buf); }
            IntPtr imp, admin; bool member = false;
            if (DuplicateToken(tok, 1, out imp)) {
                if (ConvertStringSidToSid("S-1-5-32-544", out admin)) { CheckTokenMembership(imp, admin, out member); LocalFree(admin); }
                CloseHandle(imp);
            }
            // privileges present in the token (enabled or not): a reduced token keeps only harmless ones
            var privs = new System.Collections.Generic.List<string>();
            int need; GetTokenInformation(tok, 3 /*TokenPrivileges*/, IntPtr.Zero, 0, out need);
            if (need > 0) {
                IntPtr pb = Marshal.AllocHGlobal(need);
                try {
                    if (GetTokenInformation(tok, 3, pb, need, out need)) {
                        int count = Marshal.ReadInt32(pb);
                        for (int i = 0; i < count; i++) {
                            IntPtr luid = new IntPtr(pb.ToInt64() + 4 + i * 12);
                            var sb = new System.Text.StringBuilder(64); int len = 64;
                            if (LookupPrivilegeName(null, luid, sb, ref len)) privs.Add(sb.ToString());
                        }
                    }
                } finally { Marshal.FreeHGlobal(pb); }
            }
            return "elevated=" + elevated + " elevationType=" + type + " integrity=0x" + rid.ToString("x") + " adminEnabled=" + member + " privileges=" + string.Join(",", privs.ToArray());
        } finally { CloseHandle(tok); if (pid != 0) CloseHandle(p); }
    }

    static int QueryInt(IntPtr tok, int cls) {
        IntPtr buf = Marshal.AllocHGlobal(4); int ret;
        try { return GetTokenInformation(tok, cls, buf, 4, out ret) ? Marshal.ReadInt32(buf) : -1; }
        finally { Marshal.FreeHGlobal(buf); }
    }

    // Wait on the handle Start returned; exit code, or -1 if it did not finish within ms (NOT killed here).
    public static long Wait(long handle, uint ms) {
        IntPtr p = new IntPtr(handle);
        if (WaitForSingleObject(p, ms) != 0) return -1;
        uint code; GetExitCodeProcess(p, out code); return code;
    }

    public static void CloseProcess(long handle) { CloseHandle(new IntPtr(handle)); }}
