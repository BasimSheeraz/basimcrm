/**
 * Replaces dynamic variables in snippets and templates:
 * e.g. {{first_name}}, {{name}}, {{company}}, {{sender_name}}
 */
export function interpolateSnippetVariables(
  template: string, 
  variables: { 
    name?: string; 
    fullName?: string;
    firstName?: string;
    company?: string; 
    email?: string;
    senderName?: string;
  }
): string {
  let result = template;
  const fullName = variables.fullName || variables.name || variables.email?.split('@')[0] || 'there';
  const firstName = variables.firstName || fullName.split(' ')[0] || 'there';
  const company = variables.company || 'your team';

  result = result.replace(/\{\{\s*first_name\s*\}\}/gi, firstName);
  result = result.replace(/\{\{\s*name\s*\}\}/gi, fullName);
  result = result.replace(/\{\{\s*company\s*\}\}/gi, company);
  if (variables.senderName) {
    result = result.replace(/\{\{\s*sender_name\s*\}\}/gi, variables.senderName);
  }
  return result;
}
