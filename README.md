# WhatsApp AutoGen Multi-Agent Bot

A sophisticated WhatsApp chatbot powered by Microsoft's AutoGen multi-agent framework and Azure OpenAI GPT-4. This bot uses specialized AI agents to provide intelligent, context-aware responses through your personal WhatsApp number.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **Python** 3.9+
- **Azure OpenAI Account** with GPT-4 deployment
- **WhatsApp Account**

### Installation

1. **Clone and Setup**
```bash
git clone <repository-url>
cd whats-app-chatbot
npm install
pip install -r requirements.txt
```

2. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with your Azure OpenAI credentials
```

**Required Azure OpenAI Configuration:**
```env
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_API_KEY=your-api-key-here
AZURE_OPENAI_API_VERSION=2024-12-01-preview
AZURE_OPENAI_RESOURCE_NAME=your-resource-name
```

3. **Initialize Database**
```bash
npm run setup
```

4. **Start the Bot**
```bash
npm start
```

5. **Scan QR Code**
   - QR code will appear in terminal
   - Scan with WhatsApp on your phone
   - Bot will be ready for messages!

## 🏗️ Architecture Overview

The bot uses a layered architecture with Node.js handling WhatsApp communication and Python managing AI agents:

```
┌─────────────────────────────────────────────────────────┐
│                 WhatsApp Client                         │
│                (Your Phone)                             │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              Node.js Layer                              │
│  ┌─────────────────┬──────────────┬─────────────────┐  │
│  │  WhatsApp Web   │   Business   │     Admin       │  │
│  │   Protocol      │    Logic     │   Commands      │  │
│  │   Handler       │   Engine     │   System        │  │
│  └─────────────────┴──────────────┴─────────────────┘  │
└─────────────────────┬───────────────────────────────────┘
                      │ STDIO Bridge
┌─────────────────────▼───────────────────────────────────┐
│               Python AI Layer                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │            AutoGen Orchestrator                   │ │
│  │  ┌─────────┬──────────┬─────────┬──────────────┐ │ │
│  │  │Customer │   Tech   │Research │  Scheduler   │ │ │
│  │  │Support  │ Support  │ Agent   │   Agent      │ │ │
│  │  │ Agent   │  Agent   │         │              │ │ │
│  │  └─────────┴──────────┴─────────┴──────────────┘ │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│               SQLite Database                           │
│    Users • Conversations • Logs • Analytics            │
└─────────────────────────────────────────────────────────┘
```

## 🤖 Specialized Agents

### 1. Customer Support Agent
- **Handles**: Complaints, refunds, billing issues, order problems
- **Features**: Empathetic responses, escalation detection, solution-focused
- **Triggers**: Words like "problem", "refund", "complaint", "frustrated"

### 2. Technical Support Agent  
- **Handles**: Technical problems, troubleshooting, setup assistance
- **Features**: Step-by-step guidance, error diagnosis, compatibility checks
- **Triggers**: "not working", "error", "install", "broken", "setup"

### 3. Research Agent
- **Handles**: Information requests, explanations, educational content
- **Features**: Structured responses, source guidance, fact-checking
- **Triggers**: "what is", "how does", "explain", "tell me about"

### 4. Scheduler Agent
- **Handles**: Appointments, reminders, calendar management
- **Features**: Time coordination, conflict detection, reminder setup
- **Triggers**: "schedule", "appointment", "remind me", "meeting"

## 🔧 Admin Control System

Control your bot directly through WhatsApp using admin commands:

### Basic Commands
```
/admin help                    # Show all commands
/admin stats                   # View bot statistics
/admin pause                   # Disable auto-responses
/admin resume                  # Enable auto-responses
```

### User Management
```
/admin blacklist <number>      # Block contact
/admin whitelist <number>      # Allow contact
/admin send <number> <msg>     # Send manual message
```

### Agent Management
```
/admin agent list              # List all agents
/admin agent enable <name>     # Enable specific agent
/admin agent disable <name>    # Disable specific agent
```

### Manual Override System
```
/admin override list           # Show active overrides
/admin override add <phone>    # Take manual control
/admin override remove <phone> # Return to auto mode
/admin override global on/off  # System-wide manual mode
```

## 📊 Features & Capabilities

### 🎯 **Intelligent Routing**
- Automatic intent classification
- Context-aware agent selection
- Multi-agent collaboration
- Fallback handling

### 🛡️ **Safety & Limitations**
- Rate limiting (per contact/global)
- Blacklist/whitelist management
- Business hours enforcement
- Content filtering
- Spam detection

### 💰 **Cost Management**
- Token usage tracking
- Cost estimation
- Daily/monthly budgets
- Optimization strategies

### 📈 **Analytics & Monitoring**
- Real-time metrics
- Performance tracking
- Error monitoring
- Usage analytics

### 🔒 **Security**
- Admin authentication
- Action logging
- Input sanitization
- Session management

## 📁 Project Structure

```
whats-app-chatbot/
├── nodejs/                          # Node.js layer
│   ├── index.js                    # Main application entry
│   ├── src/
│   │   ├── whatsapp/               # WhatsApp integration
│   │   │   └── message_handler.js
│   │   ├── services/               # Core services
│   │   │   ├── database.service.js
│   │   │   ├── limitation.service.js
│   │   │   ├── admin_commands.service.js
│   │   │   ├── manual_override.service.js
│   │   │   ├── metrics.service.js
│   │   │   └── notification.service.js
│   │   ├── bridge/                 # Python communication
│   │   │   └── python_bridge.js
│   │   ├── database/               # Database schema
│   │   │   └── schema.sql
│   │   └── utils/                  # Utilities
│   │       └── logger.js
│   └── package.json
│
├── python/                         # Python AI layer
│   ├── main.py                    # Python entry point
│   ├── services/                  # Core services
│   │   ├── agent_orchestrator.py
│   │   ├── claude_config.py
│   │   └── intent_classifier.py
│   ├── agents/                    # Specialized agents
│   │   ├── base_agent.py
│   │   ├── customer_support_agent.py
│   │   ├── tech_support_agent.py
│   │   ├── research_agent.py
│   │   └── scheduler_agent.py
│   ├── utils/                     # Utilities
│   │   ├── logger.py
│   │   ├── response_formatter.py
│   │   └── error_handler.py
│   └── requirements.txt
│
├── data/                          # Data directory
│   ├── database.db               # SQLite database
│   ├── logs/                     # Log files
│   ├── session/                  # WhatsApp session
│   └── backups/                  # Database backups
│
├── scripts/                       # Utility scripts
│   ├── setup.js                 # Database initialization
│   ├── health-check.js          # System health check
│   └── backup.js                # Database backup
│
├── .env.example                  # Environment template
├── .gitignore
└── README.md
```

## ⚙️ Configuration

### Environment Variables

The bot is configured via environment variables in the `.env` file:

**API Configuration**
```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

**Rate Limiting**
```env
MAX_MESSAGES_PER_MINUTE=5
MAX_MESSAGES_PER_HOUR=50
MAX_MESSAGES_PER_DAY=200
```

**Admin Settings**
```env
ADMIN_WHATSAPP_ID=1234567890@c.us
ADMIN_COMMANDS_ENABLED=true
```

**Business Hours**
```env
BUSINESS_HOURS_ENABLED=false
BUSINESS_TIMEZONE=America/New_York
BUSINESS_START_TIME=09:00
BUSINESS_END_TIME=17:00
```

### Agent Configuration

Enable/disable specific agents:
```env
CUSTOMER_SUPPORT_ENABLED=true
TECH_SUPPORT_ENABLED=true
RESEARCH_AGENT_ENABLED=true
SCHEDULER_AGENT_ENABLED=true
```

## 🚀 Deployment

### Local Development
```bash
npm run dev    # Development mode with auto-restart
```

### Production Deployment

#### Option 1: VPS/Dedicated Server
```bash
# Install PM2 for process management
npm install -g pm2

# Start with PM2
pm2 start nodejs/index.js --name whatsapp-bot
pm2 startup    # Auto-start on boot
pm2 save       # Save current processes
```

#### Option 2: Docker
```dockerfile
# Dockerfile included in repository
docker build -t whatsapp-bot .
docker run -d --name whatsapp-bot \
  -v ./data:/app/data \
  -v ./.env:/app/.env \
  whatsapp-bot
```

#### Option 3: Railway.app
```bash
# Deploy to Railway
railway login
railway init
railway up
```

## 📋 Monitoring & Maintenance

### Health Checks
```bash
npm run health    # Check system status
```

### Logs
```bash
tail -f data/logs/app.log      # Node.js logs
tail -f data/logs/python.log   # Python logs
tail -f data/logs/error.log    # Error logs
```

### Database Maintenance
```bash
# Backup database
npm run backup

# Clean old data
npm run cleanup

# View statistics
npm run stats
```

### Performance Monitoring

The bot provides real-time metrics accessible via:
- Admin commands (`/admin stats`)
- Health check endpoint
- Log analysis
- Database queries

## 💡 Usage Examples

### Basic Conversation
```
User: Hello!
Bot: 👋 Hello! I'm your AI assistant. How can I help you today?

User: What is machine learning?
Bot: Machine learning is a subset of artificial intelligence (AI) that enables 
     computers to learn and improve from data without being explicitly programmed...
```

### Customer Support
```
User: I have a problem with my order
Bot: I understand your concern and I'm here to help you resolve this issue. 
     To better assist you, could you please provide me with:
     • Your order number
     • What specific problem you're experiencing
     • When you placed the order
```

### Technical Support
```
User: The app keeps crashing
Bot: I'll help you resolve this crash issue step by step:
     
     1. First, let's restart the app completely
     2. Check if you have the latest version installed
     3. Restart your device
     4. Clear the app's cache
     
     Try these steps in order and let me know what happens after each one! 🔧
```

### Scheduling
```
User: Can we schedule a meeting for next week?
Bot: 📅 I'd be happy to help you schedule that meeting. To find the best time:
     
     • What type of meeting is this?
     • How long should it be?
     • Any preferred days or times?
     • Who else will be attending?
```

## 🔧 Troubleshooting

### Common Issues

**QR Code Not Appearing**
- Check terminal output for errors
- Ensure WhatsApp Web works in browser
- Try restarting the application

**Python Bridge Not Working**
- Verify Python dependencies: `pip install -r requirements.txt`
- Check Python logs: `tail -f data/logs/python.log`
- Ensure Python 3.9+ is installed

**Agent Not Responding**
- Check agent status: `/admin agent list`
- Verify Anthropic API key
- Check rate limits and quotas

**Database Errors**
- Ensure write permissions to `data/` directory
- Check database file isn't corrupted
- Run setup script: `npm run setup`

### Getting Help

1. **Check Logs**: Always start by checking application logs
2. **Health Check**: Run `npm run health` to verify system status
3. **Admin Commands**: Use `/admin stats` for real-time information
4. **Documentation**: Refer to the original `plan.txt` for detailed architecture

### Debug Mode

Enable detailed logging:
```env
LOG_LEVEL=debug
DEBUG_ENABLED=true
```

## 💰 Cost Estimation

### Claude API Pricing (Sonnet 4)
- **Input**: $3.00 per million tokens
- **Output**: $15.00 per million tokens

### Estimated Monthly Costs
- **Light usage** (100 messages/day): ~$5-15/month
- **Medium usage** (500 messages/day): ~$25-50/month  
- **Heavy usage** (2000 messages/day): ~$100-200/month

### Cost Optimization
- Rate limiting prevents excessive usage
- Context compression reduces token consumption
- Agent routing minimizes unnecessary processing
- Usage tracking provides cost visibility

## 🔒 Security Best Practices

1. **Environment Variables**: Never commit API keys to version control
2. **Admin Numbers**: Limit admin access to trusted contacts only
3. **Rate Limiting**: Enable aggressive rate limiting for production
4. **Monitoring**: Review logs regularly for suspicious activity
5. **Updates**: Keep dependencies updated for security patches

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- **Microsoft AutoGen** - Multi-agent conversation framework
- **Anthropic Claude** - Advanced AI language model
- **WhatsApp Web.js** - WhatsApp Web API library
- **Node.js & Python** - Runtime environments

---

**⚠️ Important Notes:**
- This bot uses your personal WhatsApp number
- Ensure compliance with WhatsApp's Terms of Service
- Monitor usage to avoid rate limits
- Regular backups recommended for production use
- Test thoroughly before deploying to production

**🎯 Next Steps:**
1. Customize agent responses for your specific use case
2. Add custom agents for specialized functionality  
3. Integrate with external APIs and services
4. Implement advanced analytics and reporting
5. Set up monitoring and alerting for production
