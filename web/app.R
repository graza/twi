#
# This is a Shiny web application. You can run the application by clicking
# the 'Run App' button above.
#
# Find out more about building applications with Shiny here:
#
#    http://shiny.rstudio.com/
#

library(shiny)
library(rredis)
library(stringr)
library(RJSONIO)

redisConnect(host = 'redis', nodelay = FALSE)
clientq <- paste0(
  "client",
  str_match_all(
    redisCmd("CLIENT", "LIST"), "id=(\\d+) .* idle=0 .* cmd=client"
  )[[1]][2]
)

finddocs <- function(query, termw, edgew) {
  if (str_length(query)) {
    #redisLPush("worker", toJSON(c("finddocs", clientq, query))
    # Using redisCmd because LPush seems to put rubbish at start of message
    redisCmd("LPUSH", "worker", toJSON(c("finddocs", clientq, query, termw, edgew)))
    reply <- redisBRPop(clientq, timeout = 60)
    #print(reply)
    return(fromJSON(reply[[clientq]]))
  }
}

# Define UI for application that draws a histogram
ui <- fluidPage(
  titlePanel("CT5107 Graph Query Engine"),
  #inputPanel(
  wellPanel(
    #verticalLayout(
      fluidRow(
        column(width = 2, "Query"),
        column(width = 10, textInput("query", NULL, placeholder = "Enter your query"))
      ),
      fluidRow(
        column(width = 2, "Term Weight"),
        column(width = 10, numericInput("termw", NULL, 1.0, min = 0, step = 0.1))
      ),
      fluidRow(
        column(width = 2, "Edge Weight"),
        column(width = 10, numericInput("edgew", NULL, 0.8, min = 0, step = 0.1))
      )
    #)
  )
  ,
  uiOutput("results")
)

# Define server logic required to draw a histogram
server <- function(input, output) {
  output$results <- renderUI({
    start_time <- proc.time()
    results <- finddocs(input$query, input$termw, input$edgew)
    query_time <- proc.time() - start_time
    tagList(
      tags$p(paste(round(query_time[3], digits = 3), "ms")),
      tags$pre(toJSON(results, pretty = TRUE))
    )
  })
}

# Run the application 
shinyApp(ui = ui, server = server)
