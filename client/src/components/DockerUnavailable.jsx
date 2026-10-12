const GRANT_COMMAND = 'sudo usermod -aG docker homelab_manager && sudo systemctl restart homelab_manager';

const REASONS = {
  'not-installed': {
    title: 'Docker is not installed',
    body: 'Install Docker on this server and its containers will show up here.',
  },
  'not-running': { title: 'Docker is not running', body: 'Start it on the server with: sudo systemctl start docker' },
  'no-permission': {
    title: 'The dashboard is not allowed to use Docker',
    body: 'Access to Docker is equivalent to root on this server, so it is not granted by default. To allow it, run this on the server:',
    command: GRANT_COMMAND,
  },
  'no-compose': {
    title: 'Docker Compose is not installed',
    body: 'Stacks need the Compose plugin. Install the docker-compose-plugin package on this server, then restart the dashboard.',
  },
};

/** Explains why Docker features are unavailable, with the fix where there is one. */
export default function DockerUnavailable({ reason }) {
  const info = REASONS[reason];
  if (!info) return null;
  return (
    <section className="card settings-card">
      <h2>{info.title}</h2>
      <p>{info.body}</p>
      {info.command && (
        <pre>
          <code>{info.command}</code>
        </pre>
      )}
    </section>
  );
}
