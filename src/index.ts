import { parseHTML } from 'linkedom';

interface Env {
  RESEND_API_KEY: string;
  TO_EMAIL: string;
  FROM_EMAIL: string;
  SENT_JOBS_KV: KVNamespace;
}

interface Role {
  company: string;
  role: string;
  applyLink: string;
}

interface StoredData {
  firstJobLink: string;
  lastUpdated: string;
  roleCount: number;
}

async function fetchReadme(): Promise<string> {
  const response = await fetch("https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md");
  if (!response.ok) {
    throw new Error(`Failed to fetch README: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function getStoredData(env: Env): Promise<StoredData | null> {
  try {
    const stored = await env.SENT_JOBS_KV.get('last_sent_data');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Error retrieving stored data:', error);
    return null;
  }
}

async function storeData(env: Env, firstJobLink: string, roleCount: number): Promise<void> {
  try {
    const data: StoredData = {
      firstJobLink,
      lastUpdated: new Date().toISOString(),
      roleCount
    };
    await env.SENT_JOBS_KV.put('last_sent_data', JSON.stringify(data));
    console.log(`Stored data: firstJobLink=${firstJobLink}, roleCount=${roleCount}`);
  } catch (error) {
    console.error('Error storing data:', error);
  }
}

async function extractSoftwareEngineeringRows(readmeContent: string, env: Env): Promise<string> {
  try {
    console.log('Starting to extract software engineering rows...');
    const lines = readmeContent.split(/\r?\n/);
    console.log(`Total lines in README: ${lines.length}`);
    
    // Find the start and end of Software Engineering section
    let startLine = -1;
    let endLine = -1;
    
    // Get the previous job link to stop processing at that point
    const storedData = await getStoredData(env);
    const previousJobLink = storedData ? storedData.firstJobLink : '';
    console.log(`Previous job link: ${previousJobLink || 'None (first run)'}`);
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('<tbody>')) {
        startLine = i;
        console.log(`Found tbody start at line ${i}`);
      }
      if (lines[i].includes('</tbody>')) {
        endLine = i;
        console.log(`Found tbody end at line ${i}`);
        break;
      }
    }

    if (startLine === -1) {
      console.error('Could not find Software Engineering section - no <tbody> tag found');
      return JSON.stringify([]);
    }

    // Extract the Software Engineering section
    const softwareEngineeringLines = lines.slice(startLine, endLine);
    console.log(`Software Engineering section has ${softwareEngineeringLines.length} lines`);
    
    // Parse the HTML table to extract role data
    const roles: Array<{
      company: string;
      role: string;
      applyLink: string;
    }> = [];
    
    let trLine = -1;
    let processedRows = 0;

    for (let i = 0; i < softwareEngineeringLines.length; i++) {
      const line = softwareEngineeringLines[i];
      
      // Start of a table row
      if (line.includes('<tr>')) {
        trLine = i;
        continue;
      }
      
      // End of a table row
      if (line.includes('</tr>')) {
        const tr = softwareEngineeringLines.slice(trLine, i);
        try {
          const { document } = parseHTML(tr.join("\n"));
          if (document) {
            // Find the first <tr> element in the parsed document
            const trElem = document.querySelector("tr");
            if (trElem) {
              const companyTd = trElem.querySelector("td:nth-child(1)");
              const roleTd = trElem.querySelector("td:nth-child(2)");
              const applyLinkA = trElem.querySelector("td:nth-child(4) a");
              const company = companyTd ? companyTd.textContent?.trim() ?? "" : "";
              const role = roleTd ? roleTd.textContent?.trim() ?? "" : "";
              const applyLink = applyLinkA ? applyLinkA.getAttribute("href") ?? "" : "";
              
              // Stop processing if we reach the previous job that was already sent
              if (previousJobLink && applyLink === previousJobLink) {
                console.log(`Reached previous job: ${company} - ${role}. Stopping processing.`);
                break;
              }
              
              roles.push({ company, role, applyLink });
              processedRows++;
            }
          }
        } catch (parseError) {
          console.error(`Error parsing row ${processedRows}:`, parseError);
          console.error(`Row content:`, tr.join("\n"));
        }
        continue;
      }
    }

    console.log(`Processed ${processedRows} rows, found ${roles.length} roles`);

    // Filter out roles that don't have proper company names and roles
    const cleanRoles = roles.filter(role => 
      role.company && 
      role.company !== 'N/A' && 
      !role.company.includes('utm_source') &&
      role.role &&
      role.role !== 'N/A' &&
      role.company !== '↳' &&
      !role.role.includes('↳') &&
      role.applyLink &&
      role.applyLink !== 'N/A'
    );

    console.log(`After filtering: ${cleanRoles.length} clean roles`);

    // Create clean JSON output
    const result = JSON.stringify(cleanRoles.slice(0, 100), null, 2);
    console.log(`Final JSON length: ${result.length} characters`);
    return result;
  } catch (error) {
    console.error('Error in extractSoftwareEngineeringRows:', error);
    return JSON.stringify([]);
  }
}

function generateEmailContent(roles: Role[]): string {
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
        h1 { color: #333; margin-bottom: 10px; }
        .summary { background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin-bottom: 20px; font-size: 14px; }
        .job-list { margin: 20px 0; }
        .job-item { margin: 8px 0; font-size: 16px; }
        .company { color: #000; font-weight: normal; }
        .job-link { color: #0066cc; text-decoration: underline; }
        .job-link:hover { text-decoration: none; }
        .footer { margin-top: 30px; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <h1>🚀 Software Engineering Internship Roles - Summer 2026</h1>
      
      <div class="summary">
        <strong>📊 Summary:</strong> Showing top ${roles.length} software engineering internship roles
        <br><strong>🕐 Last Updated:</strong> ${new Date().toLocaleString()}
      </div>
      
      <div class="job-list">
  `;

  roles.forEach((role) => {
    const jobLink = role.applyLink ? `<a href="${role.applyLink}" target="_blank" class="job-link">${role.role}</a>` : role.role;
    html += `
        <div class="job-item">
          <span class="company">${role.company}:</span> ${jobLink}
        </div>
    `;
  });

  html += `
      </div>
      
      <div class="footer">
        This is an automated email from your GitHub cron job. 
        <br>Source: <a href="https://github.com/SimplifyJobs/Summer2026-Internships" class="job-link">SimplifyJobs Summer 2026 Internships</a>
      </div>
    </body>
    </html>
  `;

  return html;
}

async function sendEmail(roles: Role[], env: Env): Promise<void> {
  const htmlContent = generateEmailContent(roles);
  
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [env.TO_EMAIL],
        subject: `🚀 Top ${roles.length} Software Engineering Internships - Summer 2026`,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Resend API error: ${response.status} ${response.statusText} - ${errorData}`);
    }

    const result = await response.json() as { id: string };
    console.log(`Email sent successfully to ${env.TO_EMAIL} with ${roles.length} roles. ID: ${result.id}`);
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}

async function runCronJob(env: Env, ctx: ExecutionContext): Promise<void> {
  try {
    console.log('Starting half-hourly cron job...');
    
    // Validate environment variables
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is not set');
    }
    if (!env.TO_EMAIL) {
      throw new Error('TO_EMAIL environment variable is not set');
    }
    if (!env.FROM_EMAIL) {
      throw new Error('FROM_EMAIL environment variable is not set');
    }
    if (!env.SENT_JOBS_KV) {
      throw new Error('SENT_JOBS_KV environment variable is not set');
    }
    
    console.log('Environment variables validated successfully');
    
    // Fetch README content
    console.log('Fetching README from GitHub...');
    const readmeContent = await fetchReadme();
    console.log(`Successfully fetched README content (${readmeContent.length} characters)`);
    
    // Extract software engineering roles
    console.log('Extracting Software Engineering roles...');
    const rolesJson = await extractSoftwareEngineeringRows(readmeContent, env);
    console.log(`Extracted roles JSON (${rolesJson.length} characters)`);
    
    // Parse the JSON string to get the roles array
    let roles: Role[];
    try {
      roles = JSON.parse(rolesJson);
    } catch (error) {
      console.error('Failed to parse roles JSON:', error);
      console.error('Roles JSON content:', rolesJson);
      throw new Error('Failed to parse roles data');
    }
    console.log(`Found ${roles.length} top software engineering roles (limited to 100)`);

    // If no roles found, don't send email
    if (roles.length === 0) {
      console.log('No roles found. Skipping email send.');
      return;
    }

    // Get the first job link to detect changes
    const currentFirstJobLink = roles[0].applyLink;
    console.log(`Current first job link: ${currentFirstJobLink}`);

    // Check if we've sent this data before
    const storedData = await getStoredData(env);

    if (storedData && storedData.firstJobLink === currentFirstJobLink) {
      console.log('No changes detected in first job. Skipping email send.');
      console.log(`Last sent: ${storedData.lastUpdated} (${storedData.roleCount} roles)`);
      return;
    }
    
    // Send email with the roles
    console.log('Changes detected! Sending email...');
    await sendEmail(roles, env);

    // Store the current first job link
    await storeData(env, currentFirstJobLink, roles.length);
    console.log('Cron job completed successfully');
  } catch (error) {
    console.error('Cron job failed:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'Unknown'
    });
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle manual trigger via HTTP request
    if (request.method === 'GET') {
      try {
        console.log('Manual trigger via HTTP request received');
        
        // Show stored data first
        const storedData = await getStoredData(env);
        let responseText = 'Cron job executed successfully\n\n';
        
        if (storedData) {
          responseText += `Stored Data:\n`;
          responseText += `- First Job Link: ${storedData.firstJobLink}\n`;
          responseText += `- Last Updated: ${storedData.lastUpdated}\n`;
          responseText += `- Role Count: ${storedData.roleCount}\n\n`;
        } else {
          responseText += `No stored data found (first run)\n\n`;
        }
        
        await runCronJob(env, ctx);
        return new Response(responseText, { status: 200 });
      } catch (error: any) {
        console.error('Error in fetch handler:', error);
        const errorMessage = `Error: ${error?.message || 'Unknown error'}`;
        console.error('Error message:', errorMessage);
        return new Response(errorMessage, { status: 500 });
      }
    }
    
    return new Response('Method not allowed', { status: 405 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Scheduled cron job triggered');
    try {
      await runCronJob(env, ctx);
    } catch (error) {
      console.error('Scheduled cron job failed:', error);
      throw error;
    }
	},
} satisfies ExportedHandler<Env>;
