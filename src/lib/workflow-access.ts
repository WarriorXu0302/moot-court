/**
 * Coze 工作流白名单与权限。
 *
 * /api/workflow/run 与 /api/workflow/history 原先接受任意 workflowId，等于让任何调用方
 * 以本系统的 Coze 凭据运行账号下的任意工作流。现在只放行下列已知 ID，并按角色限制。
 *
 * 新增工作流时必须在这里登记，否则接口返回 403。
 */
export type WorkflowAccess = 'teacher' | 'login';

export const WORKFLOW_ACCESS: Record<string, { name: string; access: WorkflowAccess }> = {
  // 案例设计（刑事）：教师
  '7656623831193223210': { name: '案例设计', access: 'teacher' },
  // 法律文书生成：教师发布案例时触发
  '7656793461539356723': { name: '法律文书生成', access: 'teacher' },
  // 判决书生成：学生走完法庭辩论后触发
  '7657514573813612550': { name: '判决书生成（辩护人/公诉人）', access: 'login' },
  // 法条检索：所有登录用户
  '7674184725792489498': { name: '法条检索', access: 'login' },
};

export function workflowAccess(workflowId: string): WorkflowAccess | null {
  return WORKFLOW_ACCESS[workflowId]?.access ?? null;
}
